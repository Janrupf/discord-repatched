declare module "asar" {
    export function extractAll(archive: string, destination: string): void
    export function createPackage(source: string, destination: string): Promise<void>
}
