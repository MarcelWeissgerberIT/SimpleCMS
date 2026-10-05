/**
 * Kind "actions": the button block's action list (editor/schema/button.ts) as a database command —
 * Add a page (an entry of this database by default, with preset values), Edit properties (the rows
 * selected in the table when started from the database page), Webhook, Open, Message. "Insert blocks"
 * is left out: a command has no place in a document.
 */
import { ListChecks } from 'lucide-react'
import { useWorkspace } from '../../../store/store'
import { useUI } from '../../../store/ui'
import { isEffectivelyTrashed } from '../../../store/selectors'
import type { Database, ID } from '../../../store/types'
import { useT, t } from '../../../i18n'
import { ButtonActionsEditor, buttonPresetValues, fillButtonVars, newButtonAction, normalizeButtonActions, openButtonTarget, sendButtonWebhook, type ButtonAction, type ButtonActionType } from '../../../editor'
import { propertyValueToText } from '../../../database'
import { CommandFailure } from '../failure'
import type { CommandKindDef, CommandPickerProps, CommandRunContext } from '../types'

export interface ActionsConfig {
  actions: ButtonAction[]
}

const TYPES: ButtonActionType[] = ['add_page', 'edit_properties', 'webhook', 'open', 'message']
const WRITES = new Set<ButtonActionType>(['add_page', 'edit_properties', 'webhook'])

/** What a command webhook sends (the button's payload, with the database and the selected rows). */
const PAYLOAD = `{
  "event": "command_run",
  "command": { "id": "…", "label": "…" },
  "database": { "id": "…", "title": "…", "url": "…" },
  "rows": [
    { "id": "…", "title": "…", "url": "…",
      "properties": { "Status": "…" } }
  ],
  "timestamp": "…",
  "source": "simplecms-one"
}`

function sanitize(raw: unknown): ActionsConfig {
  const list = raw && typeof raw === 'object' ? (raw as { actions?: unknown }).actions : undefined
  return { actions: normalizeButtonActions(list).filter((a) => TYPES.includes(a.type)) }
}

function ActionsPicker({ databaseId, config, onChange }: CommandPickerProps<ActionsConfig>) {
  const t = useT()
  const db = useWorkspace((s) => s.databases[databaseId] ?? null)
  return (
    <ButtonActionsEditor
      actions={config.actions}
      update={(fn) => onChange((c) => ({ ...c, actions: fn(c.actions) }))}
      pageId={databaseId}
      rowDb={db}
      types={TYPES}
      create={(type) => (type === 'add_page' ? { ...newButtonAction('add_page'), databaseId } as ButtonAction : newButtonAction(type))}
      notes={{ edit_properties: t('features.cmd.actions.editNote') }}
      payload={PAYLOAD}
    />
  )
}

interface Step {
  ok: boolean
  text: string
  /** said elsewhere (the message's own toast) */
  quiet?: boolean
  unconfirmed?: boolean
}

const fail = (text: string): Step => ({ ok: false, text })
const appUrl = (id: ID) => `${location.origin}${location.pathname}#/p/${id}`

function rowsPayload(dbId: ID, rowIds: ID[]) {
  const s = useWorkspace.getState()
  const db = s.databases[dbId]
  return rowIds.flatMap((id) => {
    const row = s.pages[id]
    if (!row || !db || row.databaseId !== dbId) return []
    const properties: Record<string, string> = {}
    for (const p of db.properties) {
      if (p.type === 'title') continue
      try {
        properties[p.name] = propertyValueToText(db, p, row)
      } catch {
        properties[p.name] = ''
      }
    }
    return [{ id, title: row.title, url: appUrl(id), properties }]
  })
}

async function runAction(ctx: CommandRunContext<ActionsConfig>, a: ButtonAction, now: Date): Promise<Step> {
  const s = useWorkspace.getState()
  switch (a.type) {
    case 'add_page': {
      const dbId = a.databaseId ?? ctx.databaseId
      const db = s.databases[dbId]
      const dbPage = s.pages[dbId]
      if (!db || !dbPage || isEffectivelyTrashed(s.pages, dbId)) return fail(t('features.cmd.err.dbGone'))
      const preset = buttonPresetValues(db, a.values, null, now)
      if ('error' in preset) return fail(preset.error)
      const title = fillButtonVars(a.title, now).trim()
      const id = s.createRow(dbId, { title, properties: preset.values })
      if (a.open) useUI.getState().openPeek(id)
      return { ok: true, text: t('features.cmd.actions.added', { title: title || t('common.untitled'), db: dbPage.title.trim() || t('common.untitled') }) }
    }
    case 'edit_properties': {
      const db = s.databases[ctx.databaseId]
      const rows = ctx.rowIds.map((id) => s.pages[id]).filter((r) => !!r && !r.trashed && r.databaseId === ctx.databaseId)
      if (!db || !rows.length) return fail(t('features.cmd.actions.noRows'))
      for (const row of rows) {
        const preset = buttonPresetValues(db, a.values, row, now)
        if ('error' in preset) return fail(preset.error)
        for (const [propId, value] of Object.entries(preset.values)) useWorkspace.getState().setRowProperty(row.id, propId, value)
      }
      return { ok: true, text: t(rows.length === 1 ? 'features.cmd.actions.edited.one' : 'features.cmd.actions.edited', { n: rows.length }) }
    }
    case 'webhook': {
      const page = s.pages[ctx.databaseId]
      const res = await sendButtonWebhook(a.url, a.method, {
        event: 'command_run',
        command: { id: ctx.command.id, label: ctx.command.label ?? '' },
        database: { id: ctx.databaseId, title: page?.title ?? '', url: appUrl(ctx.databaseId) },
        rows: rowsPayload(ctx.databaseId, ctx.rowIds),
        timestamp: now.toISOString(),
        source: 'simplecms-one',
      })
      return { ok: res.ok, unconfirmed: res.unconfirmed, text: t('features.cmd.actions.webhook', { method: a.method, status: res.message }) }
    }
    case 'open':
      return openButtonTarget(a)
    case 'message':
      useUI.getState().toast({ message: fillButtonVars(a.text, now).trim() || ctx.command.label || t('features.cmd.kind.actions'), kind: 'info' })
      return { ok: true, text: '', quiet: true }
    default:
      return fail(t('features.cmd.err.kind', { kind: a.type }))
  }
}

/** Every action in order (a failing one doesn't stop the next); one line for the toast. */
async function run(ctx: CommandRunContext<ActionsConfig>): Promise<string | null> {
  const now = new Date()
  if (!ctx.config.actions.length) return t('features.cmd.actions.empty')
  const steps: Step[] = []
  for (const a of ctx.config.actions) {
    try {
      steps.push(await runAction(ctx, a, now))
    } catch (e) {
      steps.push(fail((e as Error)?.message || String(e)))
    }
  }
  const said = steps.filter((x) => !x.quiet && x.text)
  // a retry would repeat what already worked (a second row …): no Retry key
  if (!steps.every((x) => x.ok)) throw new CommandFailure(said.map((x) => (x.ok ? x.text : `✕ ${x.text}`)).join(' · '), null)
  return said.map((x) => x.text).join(' · ') || null
}

/**
 * A database's commands without their webhook URLs (bearer secrets: Slack, Zapier, n8n …) — for page
 * backups people pass around (features/io, like the automations' webhooks there). Other commands stay.
 */
export function withoutCommandSecrets(db: Database): Database {
  if (!db.commands?.some((c) => c.kind === 'actions')) return db
  return {
    ...db,
    commands: db.commands.map((c) => (c.kind === 'actions' ? { ...c, config: { actions: sanitize(c.config).actions.map((a) => (a.type === 'webhook' ? { ...a, url: '' } : a)) } } : c)),
  }
}

export const actionsKind: CommandKindDef<ActionsConfig> = {
  kind: 'actions',
  label: () => t('features.cmd.kind.actions'),
  icon: ListChecks,
  Picker: ActionsPicker,
  create: () => ({ actions: [] }),
  sanitize,
  writes: (c) => c.actions.some((a) => WRITES.has(a.type)),
  unavailable: ({ config, rowIds }) => (config.actions.some((a) => a.type === 'edit_properties') && !rowIds.length ? t('features.cmd.actions.selectRows') : null),
  run,
}
