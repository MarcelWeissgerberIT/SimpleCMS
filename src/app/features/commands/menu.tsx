/**
 * The command menu of a database: "COMMANDS · <DB>", its commands in order (separators between the
 * groups), "Edit commands…". The same entries in the sidebar key, the row's ⋯ / right-click menu and
 * the database toolbar's key; ⌘K gets them flat (palette.ts).
 */
import { useState } from 'react'
import { Command, SlidersHorizontal, Zap } from 'lucide-react'
import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import type { ID } from '../../store/types'
import { Menu, type MenuEntry } from '../../ui/Menu'
import type { PopoverAnchor } from '../../ui/Popover'
import { PageIcon } from '../../ui/PageIcon'
import { Tooltip } from '../../ui/Tooltip'
import { useCloud } from '../../cloud'
import { useLang, useT, t as translate } from '../../i18n'
import { useMail } from '../mail'
import { defaultsFor } from './defaults'
import { commandEntries, readDbCommands } from './model'
import { kindWrites, useKinds } from './registry'
import { runEntry, useCommandBusy, useDbBusy, type RunOptions } from './run'
import { CmdGlyph } from './parts'
import type { CommandEntry, CommandHost, CommandSurface } from './types'

/** Open "Edit commands…" for a database. */
export function openCommandsEditor(dbId: ID): void {
  useUI.getState().openModal({ type: 'dbCommands', databaseId: dbId })
}

export interface MenuOptions {
  surface: CommandSurface
  /** rows selected on the database page (the toolbar) */
  rowIds?: ID[]
  host?: CommandHost
  /** default keys the surrounding menu has already (the row menu's own "Copy link") */
  exclude?: string[]
}

const entryWrites = (e: CommandEntry) => (e.source === 'default' ? e.spec.writes : kindWrites(e.def, e.command.config ?? {}))

/** The commands a person sees in a database's menus (not hidden; viewers: only those that don't write; known kinds). */
export function visibleEntries(dbId: ID, readOnly: boolean, exclude: string[] = []): CommandEntry[] {
  const db = useWorkspace.getState().databases[dbId]
  if (!db) return []
  return commandEntries(readDbCommands(db.commands), defaultsFor(dbId)).filter(
    (e) => !e.hidden && !exclude.includes(e.id) && (e.source === 'default' || !!e.def) && !(readOnly && entryWrites(e)),
  )
}

/** One entry → a menu item (a submenu for templates / views). */
function toItem(dbId: ID, e: CommandEntry, opts: RunOptions, busy: Record<string, true>): MenuEntry {
  const running = !!busy[`${dbId}|${e.id}`]
  const runningHint = translate('features.cmd.running')
  if (e.source === 'default') {
    const s = e.spec
    return {
      id: `cmd-${e.id}`,
      label: s.label,
      icon: <CmdGlyph icon={s.icon} led={s.led} />,
      hint: running ? runningHint : (s.disabled ?? s.hint),
      disabled: running || !!s.disabled,
      keywords: e.id,
      submenu: s.items?.map((item) => ({ id: item.id, label: item.label, icon: item.icon, checked: item.checked, onSelect: () => void runEntry(dbId, e, opts, item) })),
      onSelect: s.items ? undefined : () => void runEntry(dbId, e, opts),
    }
  }
  const why = e.def?.unavailable?.({ databaseId: dbId, config: e.command.config ?? {}, rowIds: opts.rowIds ?? [], surface: opts.surface }) ?? null
  return {
    id: `cmd-${e.id}`,
    label: e.label,
    icon: e.icon ? <PageIcon icon={e.icon} size={15} /> : <CmdGlyph icon={e.def?.icon ?? Zap} />,
    hint: running ? runningHint : (why ?? undefined),
    disabled: running || !!why,
    onSelect: () => void runEntry(dbId, e, opts),
  }
}

const groupOf = (e: CommandEntry) => (e.source === 'default' ? e.spec.group : 'own')

/**
 * The live entries of a database's command menu (re-renders with the database, the agents, the Gmail
 * sync, running commands and the language). Mount it only while the menu is open.
 */
export function useCommandMenu(dbId: ID, opts: MenuOptions, { head = true, edit = true }: { head?: boolean; edit?: boolean } = {}): MenuEntry[] {
  useLang()
  useWorkspace((s) => s.databases[dbId])
  useWorkspace((s) => s.pages[dbId]?.title)
  useWorkspace((s) => s.agents)
  useWorkspace((s) => s.settings.mail)
  useMail((s) => `${s.phase}|${s.lastAt}|${s.error}|${s.progress?.done}`)
  useKinds((s) => s.kinds)
  const busy = useCommandBusy((s) => s.busy)
  const readOnly = useCloud((s) => s.readOnly)
  const s = useWorkspace.getState()
  const db = s.databases[dbId]
  if (!db) return []
  const name = s.pages[dbId]?.title.trim() || translate('common.untitled')
  const out: MenuEntry[] = head ? [{ kind: 'section', label: translate('features.cmd.head', { db: name }) }] : []
  const list = visibleEntries(dbId, readOnly, opts.exclude)
  let prev: string | null = null
  for (const e of list) {
    const g = groupOf(e)
    if (prev && g !== prev) out.push({ kind: 'separator' })
    prev = g
    out.push(toItem(dbId, e, opts, busy))
  }
  if (!list.length) out.push({ label: translate('features.cmd.none'), disabled: true })
  if (edit && !readOnly)
    out.push({ kind: 'separator' }, { id: 'cmd-edit', label: translate('features.cmd.edit'), icon: <SlidersHorizontal size={15} strokeWidth={1.7} />, hint: db.locked ? translate('features.cmd.locked') : undefined, onSelect: () => openCommandsEditor(dbId) })
  return out
}

/** The open menu of a key (mounted only while open: the hooks above run only then). */
function CommandMenu({ dbId, anchor, onClose, opts, placement }: { dbId: ID; anchor: PopoverAnchor; onClose: () => void; opts: MenuOptions; placement?: 'bottom-start' | 'bottom-end' }) {
  const entries = useCommandMenu(dbId, opts)
  return <Menu open anchor={anchor} onClose={onClose} entries={entries} width={268} placement={placement} className="cmd-menu" />
}

export interface DbCommandKeyProps {
  dbId: ID
  /** 'sidebar': a row key (hidden on touch — the row's ⋯ menu has the commands) · 'toolbar': the database toolbar */
  variant: 'sidebar' | 'toolbar'
  rowIds?: ID[]
  host?: CommandHost
  onOpenChange?: (open: boolean) => void
}

/** The command key: ⌘ glyph, an LED while a command of the database runs (or its Gmail sync). */
export function DbCommandKey({ dbId, variant, rowIds, host, onOpenChange }: DbCommandKeyProps) {
  const t = useT()
  const [anchor, setAnchor] = useState<Element | null>(null)
  const busy = useDbBusy(dbId)
  const mailDb = useWorkspace((s) => s.settings.mail?.databaseId === dbId)
  const mailRunning = useMail((s) => s.phase !== 'idle')
  const syncing = mailDb && mailRunning
  const label = t('features.cmd.key')
  const set = (el: Element | null) => {
    setAnchor(el)
    onOpenChange?.(!!el)
  }
  const key = (
    <button
      type="button"
      className={variant === 'sidebar' ? 'sb-row__btn cmd-key cmd-key--row' : 'db-tool cmd-key'}
      aria-label={label}
      aria-haspopup="menu"
      aria-expanded={!!anchor}
      data-busy={busy || syncing || undefined}
      data-testid={variant === 'sidebar' ? 'tree-commands' : 'db-commands'}
      onClick={(e) => {
        e.stopPropagation()
        set(anchor ? null : e.currentTarget)
      }}
    >
      <Command size={14} strokeWidth={1.75} aria-hidden />
      {(busy || syncing) && <span className="led led--on cmd-key__led" aria-hidden />}
    </button>
  )
  return (
    <>
      {variant === 'toolbar' ? <Tooltip label={label}>{key}</Tooltip> : key}
      {anchor && <CommandMenu dbId={dbId} anchor={anchor} onClose={() => set(null)} opts={{ surface: variant, rowIds, host }} placement={variant === 'toolbar' ? 'bottom-end' : 'bottom-start'} />}
    </>
  )
}

/**
 * A database row's ⋯ / right-click menu with its commands on top: section COMMANDS · <DB>, the commands,
 * "Edit commands…", then the row's own entries. Render it instead of <Menu> while that menu is open.
 */
export function DbCommandsMenu({ dbId, entries, open, anchor, onClose, width = 260, host, exclude }: { dbId: ID; entries: MenuEntry[]; open: boolean; anchor: PopoverAnchor; onClose: () => void; width?: number; host?: CommandHost; exclude?: string[] }) {
  const cmds = useCommandMenu(dbId, { surface: 'sidebar', host, exclude })
  const all: MenuEntry[] = [...cmds, { kind: 'separator' }, ...entries]
  return <Menu open={open} anchor={anchor} onClose={onClose} entries={all} width={width} className="cmd-menu" />
}
