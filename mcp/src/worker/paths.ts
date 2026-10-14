/**
 * one-worker — comparing paths as the disk does: without case on Windows and macOS (their disks usually ignore it),
 * trailing separators off. Lexical only (no realpath): config.ts `inFolder` answers "inside", also through links.
 */
import { posix, win32 } from 'node:path'

const folds = (platform: NodeJS.Platform) => platform === 'win32' || platform === 'darwin'

/** A key for `p`: resolved, no trailing separator (the root keeps its own), lower case on Windows / macOS. */
export function pathId(p: string, platform: NodeJS.Platform = process.platform): string {
  const P = platform === 'win32' ? win32 : posix
  let s = P.resolve(p)
  const root = P.parse(s).root
  while (s.length > root.length && /[\\/]$/.test(s)) s = s.slice(0, -1)
  return folds(platform) ? s.toLowerCase() : s
}

/** The same folder or file (lexically). */
export function samePath(a: string, b: string, platform: NodeJS.Platform = process.platform): boolean {
  return pathId(a, platform) === pathId(b, platform)
}
