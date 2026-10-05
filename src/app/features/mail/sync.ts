/**
 * One Gmail run (loaded on first use by service.ts):
 *
 *  1. the first run (or after the date / labels changed, or an expired history) LISTS the mails after the
 *     chosen date per label; later runs ask Gmail's HISTORY for what changed since the last run;
 *  2. new mails are fetched (format=full, a few at a time, backoff on 429 — gmail.ts) up to the per-run
 *     limit, newest first; the rest waits as the backlog for the next run;
 *  3. each becomes a row (dedupe by the Gmail message id stored in the row) with its body as content
 *     (setContent(row, doc, 'mail')) and its attachments as Load keys — loaded right away when "Load
 *     attachments automatically" says so (attachments.ts); label / read changes of known mails update only Gmail's fields
 *     (Labels, Unread) — never a property the user owns, never the body;
 *  4. optional: Claude organises the new rows (organise.ts), once per mail, filling empty fields only.
 *
 * Gmail is only ever read (gmail.readonly): deleting a row in One never touches the mail in Gmail, and a
 * deleted row is not brought back by the next run.
 */
import { parse as parseDate, startOfDay } from 'date-fns'
import { plainText, useWorkspace } from '../../store/store'
import type { ID, MailPropRole, MailSettings, PropertyValue } from '../../store/types'
import { t } from '../../i18n'
import * as gmail from './gmail'
import { GmailError, type GmailCtx } from './gmail'
import { decodeBody, parseMessage, type ParsedMail } from './parse'
import { MAIL_ORIGIN, mailDoc, textHash } from './body'
import { autoFilter, loadAttachments, loadedBlocks } from './attachments'
import { TargetError, checkTarget, createMailDatabase, ensureOptions, ensureProps, inTeam, labelName, priorityOptions, rowValues, rowsByMessageId } from './schema'
import { useCloud } from '../../cloud'
import { emptyState, loadBody, loadState, saveBody, saveState, type MailSyncState } from './storage'
import { readMail, scopeOf, setMail } from './settings'
import { ORGANISE_BATCH, organiseBatch, type OrganiseMail } from './organise'

export interface RunCtx {
  token: () => string | null
  signal: AbortSignal
  progress: (p: { done: number; total: number } | null) => void
  /** Gmail asked to slow down: the run waits `ms` before the next attempt */
  retrying: (ms: number) => void
  /** the account signed in (profile), as soon as it is known */
  account?: (email: string) => void
}

export interface RunResult {
  added: number
  updated: number
  backlog: number
  /** mails synced into this database so far (this device) */
  total: number
  /** Gmail ids of the rows created in this run (organise them next) */
  created: string[]
  databaseId: ID
}

/** Mails fetched at the same time. */
const PARALLEL = 4

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x))

function inScope(labelIds: string[], cfg: MailSettings): boolean {
  if (cfg.excludeSpamTrash && (labelIds.includes('SPAM') || labelIds.includes('TRASH'))) return false
  return labelIds.some((l) => cfg.labels.includes(l))
}

/** Local midnight of the "from" day (ms). */
export function fromMs(cfg: MailSettings): number {
  const d = parseDate(cfg.from, 'yyyy-MM-dd', new Date())
  return Number.isNaN(d.getTime()) ? 0 : startOfDay(d).getTime()
}

/** The database the run writes into — created on the first run (private in a team workspace). */
function target(cfg: MailSettings): { dbId: ID; props: Partial<Record<MailPropRole, ID>> } {
  const s = useWorkspace.getState()
  if (cfg.databaseId && s.databases[cfg.databaseId]) {
    checkTarget(cfg.databaseId)
    const props = ensureProps(cfg.databaseId, cfg)
    if (JSON.stringify(props) !== JSON.stringify(cfg.props ?? {})) setMail({ props })
    return { dbId: cfg.databaseId, props }
  }
  if (cfg.databaseId) checkTarget(cfg.databaseId) // gone for good → 'trashed'
  if (inTeam() && useCloud.getState().readOnly) throw new TargetError('readonly')
  const made = createMailDatabase(cfg)
  // the date the first run listed from is kept (the default moves with the calendar)
  setMail({ databaseId: made.dbId, props: made.props, from: cfg.from })
  return made
}

/** Pages of the store: is this row still there (not deleted, not in the trash)? */
function liveRow(id: ID | undefined): boolean {
  const p = id ? useWorkspace.getState().pages[id] : undefined
  return !!p && !p.trashed
}

async function fetchBodies(g: GmailCtx, m: ParsedMail): Promise<void> {
  for (const p of m.pending) {
    try {
      const r = await gmail.attachment(g, m.id, p.attachmentId)
      if (r.data) m[p.kind] = decodeBody(r.data, p.charset)
    } catch (e) {
      if (e instanceof GmailError && (e.code === 'auth' || e.code === 'aborted')) throw e
      // the other body part (or the snippet) stands in
    }
  }
}

export async function runSync(ctx: RunCtx): Promise<RunResult> {
  let cfg = readMail()
  const g: GmailCtx = { token: ctx.token, signal: ctx.signal, onRetry: ctx.retrying }
  let state = await loadState()

  const prof = await gmail.profile(g)
  ctx.account?.(prof.emailAddress)
  if (state.account && state.account !== prof.emailAddress) state = { ...state, historyId: null, scope: null, backlog: [] }
  state.account = prof.emailAddress

  const tgt = target(cfg)
  cfg = readMail()
  if (state.databaseId !== tgt.dbId) state = { ...emptyState(), account: state.account, databaseId: tgt.dbId }
  const dbId = tgt.dbId
  const props = tgt.props

  // label names (user labels) for the Labels options
  const names = new Map((await gmail.labels(g)).map((l) => [l.id, l.name]))
  const labelOptions = (ids: string[]) => {
    const wanted = ids.map((id) => labelName(id, names)).filter(Boolean)
    if (!props.labels || !wanted.length) return []
    const map = ensureOptions(dbId, props.labels, wanted)
    return wanted.map((n) => map.get(n.toLowerCase())).filter((x): x is string => !!x)
  }

  // 1 · what is new
  const scope = scopeOf(cfg)
  let candidates: string[] = []
  const changed = new Map<string, string[] | null>()
  let historyId = state.historyId
  let full = !state.historyId || state.scope !== scope
  if (!full && state.historyId) {
    try {
      const h = await gmail.history(g, state.historyId)
      for (const [id, labels] of h.added) if (!labels || inScope(labels, cfg)) candidates.push(id)
      for (const [id, labels] of h.changed) {
        if (state.known[id]) changed.set(id, labels)
        else if (labels && inScope(labels, cfg)) candidates.push(id)
      }
      // history runs oldest → newest; listings and the backlog are newest first
      candidates.reverse()
      historyId = h.historyId
    } catch (e) {
      if (!(e instanceof GmailError) || e.code !== 'not_found') throw e
      full = true // that history is gone: list from the date again (known mails are skipped)
    }
  }
  if (full) {
    historyId = prof.historyId
    const after = Math.floor(fromMs(cfg) / 1000)
    const ids: string[] = []
    for (const label of cfg.labels) ids.push(...(await gmail.listIds(g, { q: `after:${after}`, labelIds: [label], includeSpamTrash: !cfg.excludeSpamTrash })))
    candidates = ids
    state.scope = scope
  }

  // 2 · the queue: new first, then what waited; never a mail synced before (even if its row was deleted)
  const queue = [...new Set([...candidates, ...state.backlog])].filter((id) => !state.known[id])
  const take = queue.slice(0, cfg.maxPerRun)
  const rest = queue.slice(cfg.maxPerRun)
  /** fetched and handled (a stop or failure puts the others back in front of the backlog) */
  const handled = new Set<string>()
  state.backlog = rest
  const existing = rowsByMessageId(dbId, props.messageId)
  const created: string[] = []
  let updated = 0
  const minDate = fromMs(cfg)
  // "Load attachments automatically": these load right with the new mail
  const auto = autoFilter(cfg.attachments)
  let done = 0
  ctx.progress({ done, total: take.length })

  try {
    for (let i = 0; i < take.length; i += PARALLEL) {
      const batch = take.slice(i, i + PARALLEL)
      const fetched = await gmail.mapLimit(batch, PARALLEL, async (id) => {
        try {
          return parseMessage(await gmail.message(g, id, 'full'))
        } catch (e) {
          // deleted in Gmail meanwhile: nothing to sync
          if (e instanceof GmailError && e.code === 'not_found') return null
          throw e
        }
      })
      for (const [j, m] of fetched.entries()) {
        done++
        handled.add(batch[j])
        if (!m) continue
        if (!inScope(m.labelIds, cfg) || m.date < minDate) continue
        const already = existing.get(m.id)
        if (already) {
          state.known[m.id] = { r: already, l: m.labelIds, u: m.unread }
          continue
        }
        await fetchBodies(g, m)
        const { doc, remote } = await mailDoc(m, false, props.images ?? null, { loadProp: props.load, msgId: m.id })
        const ws = useWorkspace.getState()
        if (!ws.databases[dbId]) throw new GmailError('aborted')
        const rowId = ws.createRow(dbId, { title: m.subject || t('features.mail.noSubject'), properties: rowValues(m, props, labelOptions) })
        ws.setContent(rowId, doc, MAIL_ORIGIN)
        if (auto && props.load && m.attachments.some(auto)) {
          try {
            await loadAttachments(rowId, null, g, { msg: m, filter: auto, keepHash: true })
          } catch (e) {
            // the Load keys stay; a lost sign-in or a stop ends the run
            if (e instanceof GmailError && (e.code === 'auth' || e.code === 'aborted')) throw e
          }
        }
        if (remote > 0 && m.html) await saveBody(m.id, { html: m.html, attachments: m.attachments })
        state.known[m.id] = { r: rowId, l: m.labelIds, u: m.unread, h: textHash(useWorkspace.getState().pages[rowId]?.plain ?? '') }
        existing.set(m.id, rowId)
        created.push(m.id)
      }
      ctx.progress({ done, total: take.length })
      state.backlog = [...take.filter((id) => !handled.has(id)), ...rest]
      await saveState(state)
    }

    // 3 · Gmail changed labels / read state of mails already here: only those fields follow
    for (const [id, given] of changed) {
      const k = state.known[id]
      if (!k || !liveRow(k.r)) continue
      let labels = given
      if (!labels) {
        try {
          labels = (await gmail.message(g, id, 'minimal')).labelIds ?? []
        } catch (e) {
          if (e instanceof GmailError && e.code === 'not_found') continue
          throw e
        }
      }
      const unread = labels.includes('UNREAD')
      const ws = useWorkspace.getState()
      if (!sameSet(labels, k.l) && props.labels) ws.setRowProperty(k.r, props.labels, labelOptions(labels))
      if (unread !== k.u && props.unread) ws.setRowProperty(k.r, props.unread, unread)
      if (!sameSet(labels, k.l) || unread !== k.u) updated++
      k.l = labels
      k.u = unread
    }

    state.historyId = historyId
    state.lastAt = Date.now()
    state.lastAdded = created.length
    state.lastError = null
  } finally {
    ctx.progress(null)
    state.backlog = [...take.filter((id) => !handled.has(id)), ...rest]
    await saveState(state)
  }
  return { added: created.length, updated, backlog: state.backlog.length, total: Object.keys(state.known).length, created, databaseId: dbId }
}

/* ------------------------------------------------------------------ Claude */

/** Rows to organise: these Gmail ids (default: synced, not organised yet, newest first), at most `max`. */
export async function organiseCandidates(max: number, only?: string[]): Promise<string[]> {
  const state = await loadState()
  const cfg = readMail()
  const ws = useWorkspace.getState()
  const dateOf = (rowId: ID) => {
    const v = cfg.props?.date ? ws.pages[rowId]?.properties[cfg.props.date] : null
    return v && typeof v === 'object' && !Array.isArray(v) ? v.start : ''
  }
  const ids = (only ?? Object.keys(state.known)).filter((id) => state.known[id] && !state.known[id].o && liveRow(state.known[id].r))
  if (!only) ids.sort((a, b) => dateOf(state.known[b].r).localeCompare(dateOf(state.known[a].r)))
  return ids.slice(0, max)
}

/** How many synced mails were never organised (this device). */
export async function unorganisedCount(): Promise<number> {
  const state = await loadState()
  return Object.values(state.known).filter((k) => !k.o && liveRow(k.r)).length
}

const isEmpty = (v: PropertyValue | undefined) => v === undefined || v === null || v === '' || v === false || (Array.isArray(v) && !v.length)

/**
 * Let Claude organise these mails (Gmail ids of synced rows): fills Category / Priority / Needs reply /
 * Summary / Project where the row's field is still empty, then marks them organised. Throws AIError.
 */
export async function organiseRows(ids: string[], signal: AbortSignal, progress: (p: { done: number; total: number } | null) => void): Promise<number> {
  const cfg = readMail()
  const o = cfg.organise
  if (!o.enabled || !ids.length || !cfg.databaseId) return 0
  const dbId = cfg.databaseId
  const props = ensureProps(dbId, cfg)
  if (JSON.stringify(props) !== JSON.stringify(cfg.props ?? {})) setMail({ props })
  const ws0 = useWorkspace.getState()
  // the related database's rows by title
  const projects = new Map<string, ID>()
  if (o.relationDatabaseId && props.project) {
    for (const p of Object.values(ws0.pages)) if (p.databaseId === o.relationDatabaseId && !p.trashed && p.title.trim() && !projects.has(p.title.trim())) projects.set(p.title.trim(), p.id)
  }
  const state = await loadState()
  let done = 0
  progress({ done, total: ids.length })
  try {
    for (let i = 0; i < ids.length; i += ORGANISE_BATCH) {
      const batch: OrganiseMail[] = []
      for (const id of ids.slice(i, i + ORGANISE_BATCH)) {
        const k = state.known[id]
        const row = k ? useWorkspace.getState().pages[k.r] : undefined
        if (!row || row.trashed) continue
        const str = (role: MailPropRole) => {
          const v = props[role] ? row.properties[props[role]!] : ''
          return typeof v === 'string' ? v : ''
        }
        const date = props.date ? row.properties[props.date] : null
        batch.push({
          id,
          subject: row.title,
          from: str('from'),
          date: date && typeof date === 'object' && !Array.isArray(date) ? date.start.replace('T', ' ') : '',
          text: plainText(row.content, 6000),
        })
      }
      if (batch.length) {
        const answers = await organiseBatch(batch, o, [...projects.keys()], signal)
        const cats = props.category ? ensureOptions(dbId, props.category, o.categories) : new Map<string, ID>()
        const prios = props.priority ? priorityOptions(dbId, props.priority) : new Map<string, ID>()
        for (const m of batch) {
          const a = answers.get(m.id)
          const k = state.known[m.id]
          if (!a || !k) continue
          const row = useWorkspace.getState().pages[k.r]
          if (!row) continue
          const set = (role: MailPropRole, value: PropertyValue | undefined) => {
            const pid = props[role]
            if (!pid || value === undefined || value === null || value === '') return
            if (!isEmpty(row.properties[pid])) return
            useWorkspace.getState().setRowProperty(k.r, pid, value)
          }
          if (a.category) set('category', cats.get(a.category.toLowerCase()))
          if (a.priority) set('priority', prios.get(a.priority))
          if (a.needsReply) set('needsReply', true)
          if (a.summary) set('summary', a.summary)
          if (a.project && projects.get(a.project)) set('project', [projects.get(a.project)!])
          k.o = 1
        }
        await saveState(state)
      }
      done = Math.min(ids.length, i + ORGANISE_BATCH)
      progress({ done, total: ids.length })
    }
  } finally {
    progress(null)
    await saveState(state)
  }
  return done
}

/* ------------------------------------------------------------------ "Load images" */

export type ImagesResult = 'ok' | 'edited' | 'missing' | 'none'

/**
 * Render a mail row's body again with remote images shown (`on`) or blocked. 'edited': the body was
 * changed in One since it was written (pass `force` to replace it anyway) · 'missing': this device has
 * no copy of the mail and Gmail is not connected · 'none': not a synced mail.
 */
export async function applyImages(rowId: ID, on: boolean, g: GmailCtx | null, force = false): Promise<ImagesResult> {
  const cfg = readMail()
  const row = useWorkspace.getState().pages[rowId]
  const msgProp = cfg.props?.messageId
  const msgId = row && msgProp ? row.properties[msgProp] : null
  if (!row || typeof msgId !== 'string' || !msgId) return 'none'
  const state: MailSyncState = await loadState()
  const k = state.known[msgId]
  if (!force && k?.h && textHash(row.plain ?? '') !== k.h) return 'edited'
  let src = await loadBody(msgId)
  if (!src && g?.token()) {
    const m = parseMessage(await gmail.message(g, msgId, 'full'))
    await fetchBodies(g, m)
    if (m.html) {
      src = { html: m.html, attachments: m.attachments }
      await saveBody(msgId, src)
    }
  }
  if (!src) return 'missing'
  // attachments loaded into the page keep their blocks
  const loaded = loadedBlocks(useWorkspace.getState().pages[rowId]?.content, src.attachments)
  const { doc } = await mailDoc({ html: src.html, text: null, attachments: src.attachments }, on, cfg.props?.images ?? null, { loadProp: cfg.props?.load, msgId, loaded })
  if (!useWorkspace.getState().pages[rowId]) return 'none'
  useWorkspace.getState().setContent(rowId, doc, MAIL_ORIGIN)
  if (k) {
    k.h = textHash(useWorkspace.getState().pages[rowId]?.plain ?? '')
    await saveState(state)
  }
  return 'ok'
}
