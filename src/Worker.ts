import * as Asar from "asar"
import * as OS from "os"
import * as Path from "path"
import * as ChildProcess from "child_process"
import * as Stream from "stream"
import Rimraf from "rimraf"
import {Action, ActionPayload, ApplyPatchData, MakePatchData} from "./Action"
import FS from "./BetterFS"

export default class Worker {
    private readonly discordPath: string
    private discordModulePath: string
    private stagingDir: string

    public constructor(discordPath: string) {
        this.discordPath = discordPath
        this.discordModulePath = ""
        this.stagingDir = ""
    }

    public async run(action: Action, actionPayload: ActionPayload): Promise<void> {
        const dirEntries: string[] = FS.readdirSync(this.discordPath)
            .filter((entry) => entry.match(/\d+\.\d+\.\d+/))
        if (dirEntries.length > 1) {
            console.error("Found multiple folders which could be the discord installation:")
            dirEntries.forEach((entry) => console.error(`=> ${entry}`))
            return
        } else if (dirEntries.length < 1) {
            console.error("Found no folder which could be the current discord installation")
            return
        }

        const discordInstallation: string = Path.join(this.discordPath, dirEntries[0], "modules")
        const discordVersion = dirEntries[0]
        console.log(`Found current discord installation version ${discordVersion} at ${discordInstallation}`)

        this.discordModulePath = discordInstallation

        const discordCoreModule: string = Path.join(discordInstallation, "discord_desktop_core", "core.asar")
        if (!FS.existsSync(discordCoreModule)) {
            console.error(`Discord core module ${discordCoreModule} does not exist, try running discord once`)
            return
        }

        this.stagingDir = FS.mkdtempSync(Path.join(OS.tmpdir(), "discord-repatched-"))
        console.log(`Temporary dir created at ${this.stagingDir}`)

        Asar.extractAll(discordCoreModule, Path.join(this.stagingDir, "original"))
        console.log(`Discord extracted successfully`)

        await (async () => {
            switch (action) {
                case Action.SETUP_WORKSPACE: {
                    await this.setupWorkspace((actionPayload!) as string)
                    break
                }
                case Action.PATCH_TO_LIVE_INSTALL: {
                    await this.patchToLiveInstall((actionPayload!) as string)
                    break
                }
                case Action.UNPATCH: {
                    await this.unpatch()
                    break
                }
                case Action.MAKE_PATCH: {
                    const data: MakePatchData = (actionPayload!) as MakePatchData
                    await this.makePatch(data.directory, data.outputFile)
                    break
                }
                case Action.APPLY_PATCH: {
                    const data: ApplyPatchData = (actionPayload!) as ApplyPatchData
                    await this.applyPatch(data.patchFile, data.workspace)
                    break
                }
                default:
                    throw new Error("BUG: Unsupported action")
            }
        })().finally(() => {
            Rimraf(this.stagingDir, (e) => {
                if (e) {
                    throw e
                }
            })
        })
    }

    private async setupWorkspace(targetDir: string): Promise<void> {
        if (FS.existsSync(targetDir)) {
            throw new Error(`Target dir ${targetDir} does exist already`)
        }
        await FS.copyDir(Path.join(this.stagingDir, "original"), targetDir)
    }

    private async patchToLiveInstall(targetDir: string): Promise<void> {
        const discordAppIndex: string = Path.join(targetDir, "app", "index.js")
        if (!FS.existsSync(discordAppIndex)) {
            throw new Error(`${targetDir} does not look like a discord install, missing app/index.js`)
        }

        const discordCoreIndex = await this.backupDiscordCore()

        FS.writeFileSync(discordCoreIndex, `module.exports = require("${Path.resolve(discordAppIndex)}");`)
        console.log(`Discord installation at ${this.discordPath} should now start from ${discordAppIndex}`)
    }

    private async unpatch(): Promise<void> {
        const discordCoreIndex: string =
            Path.resolve(Path.join(this.discordModulePath, "discord_desktop_core", "index.js"))
        if (!FS.existsSync(discordCoreIndex)) {
            throw new Error("Failed to find discord desktop core index.js")
        }

        const discordCoreIndexOrig: string = `${discordCoreIndex}.orig`
        if (FS.existsSync(discordCoreIndexOrig)) {
            FS.unlinkSync(discordCoreIndex)
            await FS.copy(discordCoreIndexOrig, discordCoreIndex)
        }

        const discordModdedCore = Path.resolve(
            Path.join(this.discordModulePath, "discord_desktop_core", "core.modded.asar"))
        if(FS.existsSync(discordModdedCore)) {
            FS.unlinkSync(discordModdedCore)
        }

        console.log("All patches removed!")
    }

    private makePatch(directory: string, outputFile: string): Promise<void> {
        if (FS.existsSync(outputFile)) {
            throw new Error(`${outputFile} exists already`)
        }

        return FS.copyDir(directory, Path.join(this.stagingDir, "modded")).then(() => {
            return new Promise<void>((resolve, reject) => {
                const process = ChildProcess.spawn([
                    "diff",
                    "--exclude=node_modules",
                    "--exclude=package.json",
                    "-ruN",
                    "original",
                    "modded"
                ].join(" "), {
                    shell: true,
                    cwd: this.stagingDir
                })

                let stdoutData = ""
                process.stdout.on("data", (data) => {
                    const str = data.toString()
                    for (const line of str.split("\n")) {
                        console.info(`[I/diff] ${line}`)
                    }
                    stdoutData += data.toString()
                })

                process.stderr.on("data", (data) => {
                    const str = data.toString()
                    for (const line of str.split("\n")) {
                        console.error(`[E/diff] ${line}`)
                    }
                })

                process.on("error", reject)
                process.on("exit", (code, signal) => {
                    if (code !== 0 && code !== 1) {
                        reject(`diff failed with code ${
                            code === null ? "<unknown>" : code
                        }, signal ${
                            signal === null ? "<unknown>" : signal
                        }`)
                    } else {
                        if (code === 1) {
                            FS.writeFile(outputFile, stdoutData, (err) => {
                                if (err) {
                                    reject(err)
                                } else {
                                    resolve()
                                }
                            })
                        } else {
                            console.info("No diff detected")
                            resolve()
                        }
                    }
                })
            })
        })
    }

    private async applyPatch(patchFile: string, workspace: string | undefined) {
        if(workspace) {
            return await this.applyPatchToDir(patchFile, Path.resolve(workspace))
        }

        const moddedPath = Path.join(this.stagingDir, "modded")
        const moddedAsarPath = Path.join(this.discordModulePath, "discord_desktop_core", "core.modded.asar")

        await FS.copyDir(Path.join(this.stagingDir, "original"), moddedPath)
        await this.applyPatchToDir(patchFile, moddedPath)
        console.info("Repacking to asar...")
        await Asar.createPackage(moddedPath, moddedAsarPath)
        console.info("Done!")

        const discordCoreIndex = await this.backupDiscordCore()
        FS.writeFileSync(discordCoreIndex, "module.exports = require('./core.modded.asar');");
        console.log(`Discord installation at ${this.discordPath} should now start from the modded core!`)
    }

    private applyPatchToDir(patchFile: string, dir: string): Promise<void> {
        console.info(`Applying patch to ${dir}`)
        return new Promise<void>((resolve, reject) => {
            const process = ChildProcess.spawn([
                "patch",
                "-p1",
                "-E",
                "--read-only=fail",
                "-r",
                "/dev/null",
                "-i",
                Path.resolve(patchFile)
            ].join(" "), {
                shell: true,
                cwd: dir
            })

            process.stdout.on("data", (data) => {
                const str = data.toString()
                for (const line of str.split("\n")) {
                    console.info(`[I/patch] ${line}`)
                }
            })

            process.stderr.on("data", (data) => {
                const str = data.toString()
                for (const line of str.split("\n")) {
                    console.error(`[E/patch] ${line}`)
                }
            })

            process.on("error", reject)
            process.on("exit", (code, signal) =>  {
                if(code !== 0) {
                    reject(`patch failed with code ${
                        code === null ? "<unknown>" : code
                    }, signal ${
                        signal === null ? "<unknown>" : signal
                    }`)
                } else {
                    resolve()
                }
            })
        })
    }

    private async backupDiscordCore(): Promise<string> {
        const discordCoreIndex: string =
            Path.resolve(Path.join(this.discordModulePath, "discord_desktop_core", "index.js"))
        if (!FS.existsSync(discordCoreIndex)) {
            throw new Error("Failed to find discord desktop core index.js")
        }

        const discordCoreIndexOrig: string = `${discordCoreIndex}.orig`
        if (FS.existsSync(discordCoreIndexOrig)) {
            console.log("Discord install already patched, skipping backup")
        } else {
            await FS.copy(discordCoreIndex, discordCoreIndexOrig)
        }
        return discordCoreIndex
    }
}
