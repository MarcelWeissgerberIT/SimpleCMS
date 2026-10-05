/**
 * The default commands of a database — computed from what the database is and has, never stored:
 *  - every database: New entry, From template ▸ (with row templates), Open view ▸ (two or more views),
 *    Import CSV…, Export CSV, Copy link
 *  - the Mails database (features/mail): Sync now (LED + last sync), Organise with Claude now (when on), Mail settings…
 *  - databases custom agents watch (a row trigger) or name in their scope: Run "<agent>" now, one per agent
 *  - the One memory: Open the memory log (when there is one)
 */
import { Bot, Download, FilePlus2, FileText, FileUp, LayoutTemplate, Link2, ListTree, Mail, RefreshCw, Sparkles, Table2 } from 'lucide-react'
import { createElement } from 'react'
import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import type { CustomAgent, Database, ID, Page } from '../../store/types'
import { openPage, pageHref } from '../../lib/router'
import { createEntry, exportDatabaseCsv, importCsvInto, openDatabaseView } from '../../database'
import { PageIcon } from '../../ui/PageIcon'
import { t } from '../../i18n'
import { isAIConfigured } from '../ai/client'
import { openMailSettings, organiseEarlier, syncNow, useMail } from '../mail'
import { runAgentNow } from '../agents'
import { CommandFailure } from './failure'
import type { DefaultSpec, Runner, SubItem } from './types'

const ws = () => useWorkspace.getState()

/** Phones: the drawer closes when a command opens something. */
function closeDrawer(): void {
  const ui = useUI.getState()
  if (ui.mobileSidebarOpen) ui.setMobileSidebar(false)
}

function goTo(id: ID): void {
  closeDrawer()
  const ui = useUI.getState()
  if (ui.peekPageId === id) ui.closePeek()
  openPage(id)
}

/** A new row (the first view's presets, a template's values): opened, its title ready. */
const newEntry =
  (templateId?: ID): Runner =>
  ({ databaseId, host }) => {
    if (host?.newEntry) return void host.newEntry(templateId)
    const id = createEntry(databaseId, { templateId })
    if (!id) throw new CommandFailure(t('features.cmd.err.readOnly'))
    goTo(id)
  }

/** "14:05" today, else "04 OCT 14:05". */
function clock(at: number): string {
  const d = new Date(at)
  const locale = ws().settings.language === 'de' ? 'de-DE' : 'en-US'
  const time = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false })
  if (new Date().toDateString() === d.toDateString()) return time
  return `${d.toLocaleDateString(locale, { day: '2-digit', month: 'short' }).toUpperCase()} ${time}`
}

/** The Gmail sync's read-out for "Sync now": LED + text. */
export function mailReadout(): { led: 'off' | 'on' | 'ok'; hint: string } {
  const m = useMail.getState()
  if (m.phase !== 'idle') return { led: 'on', hint: m.progress?.total ? `${m.progress.done}/${m.progress.total}` : t('features.cmd.mail.running') }
  if (m.error && m.errorAt === 'sync') return { led: 'off', hint: t('features.cmd.mail.error') }
  if (m.lastAt) return { led: 'ok', hint: clock(m.lastAt) }
  return { led: 'off', hint: '' }
}

const mailFailure = (text: string) => new CommandFailure(text, { label: t('features.cmd.mail.settings'), run: openMailSettings })

async function runSync(): Promise<string | null> {
  const before = useMail.getState().lastAt
  await syncNow({ connect: true })
  const m = useMail.getState()
  if (m.error) throw mailFailure(m.error)
  if (m.lastAt === before) return null
  // new mails: the sync's own toast says how many (with "Open")
  return m.lastAdded ? null : t('features.cmd.mail.syncedNone')
}

async function runOrganise(): Promise<string> {
  const before = useMail.getState().unorganised
  await organiseEarlier()
  const m = useMail.getState()
  if (m.error) throw mailFailure(m.error)
  const n = Math.max(0, before - m.unorganised)
  return n ? t(n === 1 ? 'features.cmd.mail.organised.one' : 'features.cmd.mail.organised', { n }) : t('features.cmd.mail.organisedNone')
}

/** Agents that watch the database (a row trigger) or name it in their scope, by name. */
export function agentsOf(dbId: ID, agents: Record<ID, CustomAgent> | undefined): CustomAgent[] {
  return Object.values(agents ?? {})
    .filter((a) => ((a.trigger.type === 'row_created' || a.trigger.type === 'row_changed') && a.trigger.databaseId === dbId) || a.scope.databases.includes(dbId))
    .sort((a, b) => a.name.localeCompare(b.name))
}

const runAgent =
  (agentId: ID): Runner =>
  async () => {
    const agent = ws().agents?.[agentId]
    if (!agent) throw new CommandFailure(t('features.cmd.err.agentGone'))
    await runAgentNow(agent)
  }

/** The oldest live memory log (features/ai/memory: Database.system 'memory-log'). */
function memoryLog(pages: Record<ID, Page>, databases: Record<ID, Database>): ID | null {
  const logs = Object.values(databases)
    .filter((d) => d.system === 'memory-log' && pages[d.id] && !pages[d.id].trashed)
    .sort((a, b) => pages[a.id].createdAt - pages[b.id].createdAt)
  return logs[0]?.id ?? null
}

async function copyLink(dbId: ID): Promise<string> {
  const url = `${location.origin}${location.pathname}${pageHref(dbId)}`
  try {
    await navigator.clipboard?.writeText(url)
  } catch {
    throw new CommandFailure(t('features.cmd.err.clipboard'))
  }
  return t('features.cmd.res.copied')
}

/** The defaults that apply to a database now, in their default order. */
export function defaultsFor(dbId: ID): DefaultSpec[] {
  const s = ws()
  const db = s.databases[dbId]
  if (!db) return []
  const untitled = t('common.untitled')
  const out: DefaultSpec[] = [{ key: 'new-entry', group: 'db', label: t('features.cmd.newEntry'), icon: FilePlus2, writes: true, hint: '↵', run: newEntry() }]
  const templates = db.templates ?? []
  if (templates.length)
    out.push({
      key: 'templates',
      group: 'db',
      label: t('features.cmd.fromTemplate'),
      icon: LayoutTemplate,
      writes: true,
      items: templates.map<SubItem>((tpl) => ({
        id: tpl.id,
        label: tpl.name.trim() || untitled,
        icon: tpl.icon ? createElement(PageIcon, { icon: tpl.icon, size: 15 }) : createElement(FileText, { size: 15 }),
        run: newEntry(tpl.id),
      })),
    })
  if (db.views.length > 1)
    out.push({
      key: 'views',
      group: 'db',
      label: t('features.cmd.openView'),
      icon: Table2,
      writes: false,
      items: db.views.map<SubItem>((v) => ({
        id: v.id,
        label: v.name.trim() || t(`database.view.${v.type}`),
        run: ({ databaseId, host }) => {
          if (host?.openView) return void host.openView(v.id)
          closeDrawer()
          if (!openDatabaseView(databaseId, v.id)) throw new CommandFailure(t('features.cmd.err.viewGone'))
        },
      })),
    })
  out.push(
    {
      key: 'import-csv',
      group: 'db',
      label: t('features.cmd.importCsv'),
      icon: FileUp,
      writes: true,
      run: ({ databaseId, surface }) => {
        // the dialog for unknown columns lives in the database's view: open its page first
        if (surface !== 'toolbar') goTo(databaseId)
        importCsvInto(databaseId)
      },
    },
    {
      key: 'export-csv',
      group: 'db',
      label: t('features.cmd.exportCsv'),
      icon: Download,
      writes: false,
      hint: '.CSV',
      run: ({ databaseId, host }) => {
        const n = host?.exportCsv ? host.exportCsv() : exportDatabaseCsv(databaseId)
        if (n === null || n === undefined) throw new CommandFailure(t('features.cmd.err.dbGone'))
        return t(n === 1 ? 'features.cmd.res.exported.one' : 'features.cmd.res.exported', { n })
      },
    },
    { key: 'copy-link', group: 'db', label: t('common.copyLink'), icon: Link2, writes: false, run: ({ databaseId }) => copyLink(databaseId) },
  )

  if (s.settings.mail?.databaseId === dbId) {
    const read = mailReadout()
    const busy = useMail.getState().phase !== 'idle'
    out.push({ key: 'mail-sync', group: 'mail', label: t('features.cmd.mail.sync'), icon: RefreshCw, writes: true, hint: read.hint, led: read.led, disabled: busy ? read.hint : undefined, run: runSync })
    if (s.settings.mail.organise?.enabled && isAIConfigured())
      out.push({ key: 'mail-organise', group: 'mail', label: t('features.cmd.mail.organise'), icon: Sparkles, writes: true, disabled: busy ? t('features.cmd.mail.running') : undefined, run: runOrganise })
    out.push({ key: 'mail-settings', group: 'mail', label: t('features.cmd.mail.settings'), icon: Mail, writes: false, run: () => void openMailSettings() })
  }

  for (const agent of agentsOf(dbId, s.agents))
    out.push({ key: `agent:${agent.id}`, group: 'agent', label: t('features.cmd.agent', { name: agent.name }), icon: Bot, writes: true, run: runAgent(agent.id) })

  if (db.system === 'memory') {
    const log = memoryLog(s.pages, s.databases)
    if (log) out.push({ key: 'memory-log', group: 'memory', label: t('features.cmd.memoryLog'), icon: ListTree, writes: false, run: () => goTo(log) })
  }
  return out
}
