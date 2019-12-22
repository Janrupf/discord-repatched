export enum Action {
    NONE,
    SETUP_WORKSPACE,
    PATCH_TO_LIVE_INSTALL,
    UNPATCH,
    MAKE_PATCH,
    APPLY_PATCH
}

export interface MakePatchData {
    directory: string,
    outputFile: string
}

export interface ApplyPatchData {
    patchFile: string,
    workspace: string | undefined
}

export type ActionPayload = undefined | string | MakePatchData | ApplyPatchData
