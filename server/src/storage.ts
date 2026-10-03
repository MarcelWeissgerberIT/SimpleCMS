import { join } from 'node:path'

/**
 * Where a workspace's file bytes live (never in a served path):
 *   DATA_DIR/files/<workspaceId>/<fileId>.enc   sealed with the workspace's key (every upload since encryption)
 *   DATA_DIR/files/<workspaceId>/<fileId>       plaintext from before encryption, until the migration sealed it
 * File ids are `[A-Za-z0-9_-]{1,64}`, so `<id>.enc` never collides with another id.
 */
export const filesDir = (dataDir: string, workspaceId: string) => join(dataDir, 'files', workspaceId)
export const sealedPath = (dataDir: string, workspaceId: string, fileId: string) => join(filesDir(dataDir, workspaceId), `${fileId}.enc`)
export const legacyPath = (dataDir: string, workspaceId: string, fileId: string) => join(filesDir(dataDir, workspaceId), fileId)
