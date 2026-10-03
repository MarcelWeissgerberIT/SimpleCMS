/**
 * Sync bookkeeping types (folder + GitHub). Everything here is per device and per workspace
 * (IndexedDB `one-sync`), never part of the workspace data, never exported or shared.
 */
import type { ID } from '../../store/types'

/** What a synced file holds. */
export type FileKind = 'page' | 'row' | 'database' | 'csv' | 'file'

/** One file of the layout as it should be. */
export interface Desired {
  path: string
  kind: FileKind
  /** page / row / database id (database + csv: the database id) */
  id?: ID
  /** attachments: the onefile ref */
  ref?: string
  /** in the trash (".trash/…") */
  trashed?: boolean
}

/** What was last written / seen for a path. */
export interface ManifestEntry {
  kind: FileKind
  id?: ID
  ref?: string
  /** git blob id of the file as it is on the target (written by One, or seen after a pick-up) */
  sha: string
  /** git blob id of One's own rendering at that moment ('' = One has never written it) */
  out: string
  /** folder: lastModified + size after the last write / read (cheap change check) */
  mtime?: number
  size?: number
  /** page title when it was written (external title edits are told apart from One's) */
  title?: string
}

export interface Manifest {
  entries: Record<string, ManifestEntry>
  /** folder: when it was connected — Markdown files older than that were there before and stay untouched */
  since?: number
  /** GitHub: commit the last push / pull is based on */
  head?: string
  /** GitHub: remote versions that lost a conflict — committed as "(conflict …)" copies on the next push */
  conflicts?: Array<{ path: string; sha: string }>
}

export const emptyManifest = (): Manifest => ({ entries: {} })

export type TargetKind = 'folder' | 'github'

export type LogKind = 'write' | 'pickup' | 'push' | 'pull' | 'conflict' | 'error' | 'connect'

export interface LogEntry {
  at: number
  target: TargetKind
  kind: LogKind
  /** numbers / names for the message `features.sync.log.<kind>` */
  vars?: Record<string, string | number>
}

/** Per target read-out (saved, so every tab shows the same). */
export interface TargetStatus {
  lastAt: number | null
  files: number
  pending: number
  error: string | null
}

export const emptyStatus = (): TargetStatus => ({ lastAt: null, files: 0, pending: 0, error: null })

export interface GitHubConfig {
  /** "owner/repo" */
  repo: string
  branch: string
  /** folder inside the repository ("" = root), no leading / trailing slash */
  prefix: string
  /** fine-grained personal access token — this browser only */
  token: string
  auto: boolean
  everyMin: number
}

export const defaultGitHubConfig = (): GitHubConfig => ({ repo: '', branch: 'main', prefix: '', token: '', auto: false, everyMin: 10 })
