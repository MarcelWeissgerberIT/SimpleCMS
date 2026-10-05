/**
 * Running a database command: one at a time per command, a busy flag for the keys (LED), the outcome
 * as a toast ("Mails · Export CSV · 12 rows"), a failure as an error toast with Retry (or the
 * failure's own action, e.g. "Mail settings").
 */
import { create } from 'zustand'
import { useUI } from '../../store/ui'
import type { ID } from '../../store/types'
import { useCloud } from '../../cloud'
import { t } from '../../i18n'
import { useWorkspace } from '../../store/store'
import { CommandFailure } from './failure'
import type { CommandEntry, CommandHost, CommandSurface, Runner, SubItem } from './types'

/** Commands running now, by "<databaseId>|<commandId>". */
export const useCommandBusy = create<{ busy: Record<string, true> }>(() => ({ busy: {} }))

const busyKey = (dbId: ID, id: string) => `${dbId}|${id}`
const setBusy = (k: string, on: boolean) =>
  useCommandBusy.setState((s) => {
    const busy = { ...s.busy }
    if (on) busy[k] = true
    else delete busy[k]
    return { busy }
  })

/** Is any command of this database running? (the key's LED) */
export const useDbBusy = (dbId: ID): boolean => useCommandBusy((s) => Object.keys(s.busy).some((k) => k.startsWith(`${dbId}|`)))

export interface RunOptions {
  surface: CommandSurface
  rowIds?: ID[]
  host?: CommandHost
}

/** The name in toasts: "<database> · <command>". */
function title(dbId: ID, label: string): string {
  const db = useWorkspace.getState().pages[dbId]?.title.trim() || t('common.untitled')
  return `${db} · ${label}`
}

async function exec(dbId: ID, id: string, label: string, runner: Runner, opts: RunOptions): Promise<void> {
  const k = busyKey(dbId, id)
  if (useCommandBusy.getState().busy[k]) return
  setBusy(k, true)
  const ui = useUI.getState()
  try {
    const res = await runner({ databaseId: dbId, rowIds: opts.rowIds ?? [], surface: opts.surface, host: opts.host })
    if (typeof res === 'string' && res) ui.toast({ message: `${title(dbId, label)} · ${res}`, kind: 'success' })
  } catch (e) {
    const failure = e instanceof CommandFailure ? e : null
    const msg = (e as Error)?.message || String(e)
    ui.toast({
      message: `${title(dbId, label)} · ${msg}`,
      kind: 'error',
      timeout: 8000,
      action: failure?.action === null ? undefined : (failure?.action ?? { label: t('features.cmd.retry'), run: () => void exec(dbId, id, label, runner, opts) }),
    })
  } finally {
    setBusy(k, false)
  }
}

/** Run a menu entry (a default, or an own command through its kind); `sub`: an item of its submenu. */
export function runEntry(dbId: ID, entry: CommandEntry, opts: RunOptions, sub?: SubItem): Promise<void> {
  if (entry.source === 'default') {
    if (sub) return exec(dbId, `${entry.id}/${sub.id}`, `${entry.spec.label} · ${sub.label}`, sub.run, opts)
    if (!entry.spec.run) return Promise.resolve()
    return exec(dbId, entry.id, entry.spec.label, entry.spec.run, opts)
  }
  const { def, command } = entry
  return exec(dbId, entry.id, entry.label, async (ctx) => {
    if (!def) throw new CommandFailure(t('features.cmd.err.kind', { kind: command.kind }))
    return def.run({
      databaseId: ctx.databaseId,
      command,
      config: command.config ?? {},
      workspace: useCloud.getState().active.kind === 'cloud' ? 'cloud' : 'local',
      rowIds: ctx.rowIds,
      surface: ctx.surface,
    })
  }, opts)
}
