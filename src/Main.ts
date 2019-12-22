import Commander from "commander"
import * as FS from "fs"
import * as OS from "os"
import * as Path from "path"
import {Action, ActionPayload} from "./Action"
import Worker from "./Worker"

export = async () => {
    const homedir: string = OS.homedir()
    let action: Action = Action.NONE
    let payload: ActionPayload

    Commander
        .version("0.1.0")
        .option("-d, --discord <directory>", "Path to discord installation")

    Commander
        .command("setup-workspace <directory>")
        .description("Sets up a workspace for hacking on discord at <directory>")
        .alias("sw")
        .action((dir: string) => {
            payload = dir
            action = Action.SETUP_WORKSPACE
        })

    Commander
        .command("patch-to-live <directory>")
        .description("Patches a discord install to run from <directory>")
        .alias("ptl")
        .action((dir: string) => {
            payload = dir
            action = Action.PATCH_TO_LIVE_INSTALL
        })

    Commander
        .command("unpatch")
        .description("Removes all applied patches from the selected discord installation")
        .alias("up")
        .action(() => {
            action = Action.UNPATCH
        })

    Commander
        .command("make-patch <directory> <output>")
        .description("Creates a diff of a discord installation and the workspace <directory>")
        .alias("mp")
        .action((dir: string, output: string) => {
            payload = {directory: dir, outputFile: output}
            action = Action.MAKE_PATCH
        })

    Commander
        .command("apply-patch <file>")
        .description("Applies patch to discord or a workspace (see apply-patch --help) from <file>")
        .alias("ap")
        .option("-w, --workspace <workspace>",
            "Don't apply the patch to a discord instance, but to the workspace at <workspace>")
        .action((file: string, data: {workspace: string | undefined}) => {
            payload = {
                patchFile: file,
                workspace: data.workspace
            }
            action = Action.APPLY_PATCH
        })

    const args = Commander.parse(process.argv)

    if(!action) {
        console.error("No action selected, use --help to get help")
        process.exit(1)
    }

    const discordPath: string = (() => {
        if(args.discord) {
            if(!FS.existsSync(args.discord)) {
                throw new Error(`${args.discord} does not exist`)
            }
            console.log(`Found discord at ${args.discord}`)
            return args.discord
        }

        const discordReleasePath: string = Path.join(homedir, ".config", "discord")
        if(FS.existsSync(discordReleasePath)) {
            console.log(`Found discord release at ${discordReleasePath}`)
            return discordReleasePath
        }

        const discordCanaryPath: string = Path.join(homedir, ".config", "discordcanary")
        if(FS.existsSync(discordCanaryPath)) {
            console.log(`Found discord canary at ${discordCanaryPath}`)
            return discordCanaryPath
        }

        const discordPtbPath: string = Path.join(homedir, ".config", "discordptb")
        if(FS.existsSync(discordPtbPath)) {
            console.log(`Found discord ptb at ${discordPtbPath}`)
            return discordPtbPath
        }
        throw new Error("Failed to find discord")
    })()

    const worker: Worker = new Worker(discordPath)
    await worker.run(action, payload)
}
