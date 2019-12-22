import * as NodeFS from "fs"
import * as Path from "path"
import * as Stream from "stream"

async function copy(source: string, target: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        Stream.pipeline(
            NodeFS.createReadStream(source),
            NodeFS.createWriteStream(target),
            (err) => {
                if(err) {
                    reject(err)
                } else {
                    resolve()
                }
            })
    })
}

async function copyDir(source: string, target: string) {
    if(!NodeFS.existsSync(target)) {
        NodeFS.mkdirSync(target, {
            recursive: true
        })
    }

    for(const file of NodeFS.readdirSync(source)) {
        const stat = NodeFS.lstatSync(Path.join(source, file))
        if(stat.isDirectory()) {
            await copyDir(Path.join(source, file), Path.join(target, file))
        } else if(stat.isSymbolicLink()) {
            const symlink = NodeFS.readlinkSync(Path.join(source, file))
            NodeFS.symlinkSync(symlink, Path.join(target, file))
        } else {
            await copy(Path.join(source, file), Path.join(target, file))
        }
    }
}

const additions = {
    copy,
    copyDir
}

type BetterFSType = typeof NodeFS & typeof additions

const BetterFS: BetterFSType = Object.assign({}, NodeFS, additions)

export default BetterFS
