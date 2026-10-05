/**
 * Database commands — the shapes shared by the menu, the runner, the editor and the kinds.
 */
import type { ComponentType, ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import type { DbCommand, ID, PageIcon } from '../../store/types'

/** Where a command was started. */
export type CommandSurface = 'sidebar' | 'toolbar' | 'palette'

/** What a command's `run` gets. */
export interface CommandRunContext<C = Record<string, unknown>> {
  databaseId: ID
  /** the stored command (label, icon …) */
  command: DbCommand
  /** its settings, sanitized by the kind */
  config: C
  /** 'local' = this browser's workspace · 'cloud' = a team workspace */
  workspace: 'local' | 'cloud'
  /** the rows selected on the database page when the command was started there (else empty) */
  rowIds: ID[]
  surface: CommandSurface
}

/** The settings form of an own command (in "Edit commands…"). */
export interface CommandPickerProps<C = Record<string, unknown>> {
  databaseId: ID
  config: C
  /** an updater: several changes in one tick never overwrite each other */
  onChange: (fn: (config: C) => C) => void
}

/**
 * A kind of own command (registerCommandKind). `run` resolves with the outcome line of the toast
 * ("12 rows exported"; null / nothing: no toast) and throws for a failure (an error toast with Retry).
 */
export interface CommandKindDef<C = Record<string, unknown>> {
  /** stored as DbCommand.kind: [a-z][a-z0-9-]{1,23}, never 'default' */
  kind: string
  /** its name in "Add command" and the editor (a function: translated when shown) */
  label: string | (() => string)
  icon: LucideIcon
  Picker: ComponentType<CommandPickerProps<C>>
  /** the settings of a new command (default: {}) */
  create?: (databaseId: ID) => C
  /** stored (untrusted) settings → clean ones; null drops the command (default: the plain JSON object) */
  sanitize?: (raw: unknown) => C | null
  /** it writes to the workspace — viewers of a team workspace don't get it (default: true) */
  writes?: boolean | ((config: C) => boolean)
  /** why it can't run now (shown as the item's hint, the item disabled), or null */
  unavailable?: (ctx: Pick<CommandRunContext<C>, 'databaseId' | 'config' | 'rowIds' | 'surface'>) => string | null
  run: (ctx: CommandRunContext<C>) => Promise<string | null | void> | string | null | void
}

/**
 * The database page's own ways for a command started there (the toolbar): a new row like its "New",
 * its view switch, its CSV export (current view and search). Elsewhere the defaults go through the
 * database's public API.
 */
export interface CommandHost {
  newEntry?: (templateId?: ID) => void
  openView?: (viewId: ID) => void
  exportCsv?: () => number | null
}

export type Runner = (ctx: { databaseId: ID; rowIds: ID[]; surface: CommandSurface; host?: CommandHost }) => Promise<string | null | void> | string | null | void

/** One item of a default's submenu (a template, a view). */
export interface SubItem {
  id: string
  label: string
  icon?: ReactNode
  checked?: boolean
  run: Runner
}

/** A computed default command of a database (never stored; only its place and `hidden`). */
export interface DefaultSpec {
  /** the stored id: 'new-entry', 'templates', 'views', 'import-csv', 'export-csv', 'copy-link', 'mail-sync', 'mail-organise', 'mail-settings', 'agent:<id>', 'memory-log' */
  key: string
  group: 'db' | 'mail' | 'agent' | 'memory'
  label: string
  icon: LucideIcon
  writes: boolean
  /** the item's right-hand read-out ("↵", "14:05" …) */
  hint?: string
  /** an LED in the icon (the Gmail sync) */
  led?: 'off' | 'on' | 'ok'
  /** a submenu instead of running */
  items?: SubItem[]
  run?: Runner
  /** shown, but can't run now (the hint says why) */
  disabled?: string
}

/** A command of the menu: a default or an own command, in the database's order. */
export type CommandEntry =
  | { id: string; source: 'default'; hidden: boolean; spec: DefaultSpec }
  | { id: string; source: 'own'; hidden: boolean; command: DbCommand; def: CommandKindDef | null; label: string; icon: PageIcon | null }
