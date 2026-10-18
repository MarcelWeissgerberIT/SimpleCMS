/**
 * Work orders — "Prüfen lassen" / "Have it checked" (spec §1.2, B4): any page becomes a request.
 *
 *  - Viewers: never (the command is not offered). Coding off on this device: nothing happens — "Coding ist auf diesem
 *    Gerät aus" with a key to Settings › Coding-Worker (⌘K finds the command anyway; the menus offer it only while Coding
 *    is on).
 *  - A pipeline task's page: refused (it runs in its pipeline already). A request row: its plate opens.
 *  - A live request that already links the page and is not Fertig / Angehalten: THAT one opens (the side peek) —
 *    "Schon in PA-12 (Läuft)", with N Neuer Auftrag in the toast.
 *  - Otherwise a new row in the work-orders database (made on first use: "Prüfaufträge angelegt · PA-1 · Z Rückgängig"),
 *    titled like the page, its body "Seite: @<Seite>" (with the note above it — "Prüfen lassen …"), Status Planen, opened
 *    in the side peek; then the press (press.ts, how 'send'). The source page is not changed — the mention is its
 *    backlink.
 */
import type { JSONContent } from '@tiptap/core'
import { useWorkspace } from '../../../store/store'
import { inTemplate, isEffectivelyTrashed } from '../../../store/selectors'
import type { ID } from '../../../store/types'
import { withWriter, type Writer } from '../../../store/writer'
import { useUI } from '../../../store/ui'
import { useCloud } from '../../../cloud'
import { t } from '../../../i18n'
import { navigate } from '../../../lib/router'
import { useCoding } from '../state'
import { kindOfDb } from '../schema'
import { openCodingSettings } from '../open'
import { refIdsIn } from '../refs'
import { readOrderConfig } from './config'
import { ensureOrderDb, isOrderRow, orderCode, orderProps, orderRowIds, orderStatusKey } from './db'
import { pressPlan, pressProv } from './press'
import { preWhyText, untilText } from './text'
import { ORDER_LIMITS } from './types'

const ws = () => useWorkspace.getState()
const ui = () => useUI.getState()

/** The person's command (the row it makes is theirs; the Status Planen is written with it). */
const COMMAND: Writer = { kind: 'you', via: 'command' }

/** May "Prüfen lassen" be offered on this page now (the page menu, the sidebar row menu: only while Coding is on)? */
export function canSendToOrders(pageId: ID | null | undefined, opts: { menu?: boolean } = {}): boolean {
  if (!pageId || useCloud.getState().readOnly) return false
  if (opts.menu && !useCoding.getState().enabled) return false
  const s = ws()
  const page = s.pages[pageId]
  if (!page || page.trashed || page.kind === 'database' || isEffectivelyTrashed(s.pages, pageId) || inTemplate(s.pages, pageId)) return false
  // a request itself: its plate is right there (⌘K still opens it — sendToOrders)
  if (opts.menu && isOrderRow(pageId, s)) return false
  // a pipeline task is in its pipeline already
  return !kindOfDb(page.databaseId)
}

/** The open request (not Fertig / Angehalten) that links this page, if any — the oldest. */
export function openRequestFor(pageId: ID): ID | null {
  const s = ws()
  let best: { id: ID; at: number } | null = null
  for (const id of orderRowIds(s)) {
    const p = s.pages[id]
    if (!p || id === pageId) continue
    const key = orderStatusKey(id, s)
    if (key === 'done' || key === 'halted') continue
    if (!refIdsIn(p.content?.content ?? [], id).includes(pageId)) continue
    if (!best || p.createdAt < best.at) best = { id, at: p.createdAt }
  }
  return best?.id ?? null
}

function statusName(rowId: ID): string {
  const key = orderStatusKey(rowId)
  return key ? t(`features.coding.order.status.${key}`) : '—'
}

function openRow(rowId: ID): void {
  if (ui().mobileSidebarOpen) ui().setMobileSidebar(false)
  ui().openPeek(rowId)
}

/** The body of a new request: the note (when given), then "Seite: @<page>". */
function body(pageId: ID, note: string): JSONContent {
  const page = ws().pages[pageId]!
  // mentions of private pages carry no label (team)
  const mention: JSONContent = { type: 'mention', attrs: { id: pageId, label: page.private ? null : page.title.trim() || t('common.untitled'), kind: 'page' } }
  const content: JSONContent[] = []
  if (note.trim()) content.push({ type: 'paragraph', content: [{ type: 'text', text: note.trim().slice(0, 2000) }] })
  content.push({ type: 'paragraph', content: [{ type: 'text', text: `${t('features.coding.order.send.page')} ` }, mention] })
  return { type: 'doc', content }
}

export type SendResult = 'made' | 'existing' | 'opened' | 'refused'

/**
 * "Prüfen lassen" on a page (see the head of this file). `note`: "Prüfen lassen …"'s one line; `fresh`: a new request
 * even when an open one links the page (N in "Schon in …").
 */
export function sendToOrders(pageId: ID, opts: { note?: string; fresh?: boolean } = {}): SendResult {
  if (useCloud.getState().readOnly) {
    ui().toast({ message: t('features.coding.setup.readOnly'), kind: 'error' })
    return 'refused'
  }
  if (!useCoding.getState().enabled) {
    ui().toast({ message: t('features.coding.order.why.codingOff'), kind: 'error', action: { label: t('features.coding.order.send.settings'), run: () => openCodingSettings() } })
    return 'refused'
  }
  const s = ws()
  const page = s.pages[pageId]
  if (!page || page.trashed) return 'refused'
  // a request row: its plate
  if (isOrderRow(pageId)) {
    navigate({ name: 'page', id: pageId })
    return 'opened'
  }
  if (!canSendToOrders(pageId)) {
    ui().toast({ message: t(kindOfDb(page.databaseId) ? 'features.coding.order.send.task' : 'features.coding.order.send.cannot'), kind: 'error' })
    return 'refused'
  }
  if (!opts.fresh) {
    const open = openRequestFor(pageId)
    if (open) {
      openRow(open)
      ui().toast({
        message: t('features.coding.order.already', { id: orderCode(open) ?? (ws().pages[open]?.title.trim() || t('common.untitled')), status: statusName(open) }),
        action: { label: t('features.coding.order.send.fresh'), run: () => void sendToOrders(pageId, { ...opts, fresh: true }) },
      })
      return 'existing'
    }
  }
  let made: { id: ID; made: boolean }
  try {
    made = ensureOrderDb(COMMAND)
  } catch {
    ui().toast({ message: t('features.coding.setup.readOnly'), kind: 'error' })
    return 'refused'
  }
  const db = ws().databases[made.id]!
  const read = readOrderConfig(db)
  const statusProp = orderProps(db).status
  const plan = read.kind === 'ok' ? read.config.status.plan : undefined
  const rowId = withWriter(COMMAND, () =>
    ws().createRow(made.id, {
      // the database is private in a team, so a private page's title stays where it may be
      title: page.title.trim().slice(0, 200),
      properties: statusProp && plan ? { [statusProp]: plan } : {},
      content: body(pageId, opts.note ?? ''),
    }),
  )
  openRow(rowId)
  if (made.made) {
    const code = orderCode(rowId) ?? ''
    ui().toast({
      message: t('features.coding.order.created', { id: code }),
      kind: 'success',
      action: {
        label: t('common.undo'),
        undo: true,
        run: () => {
          if (ui().peekPageId === rowId) ui().closePeek()
          // the database with its first request: both were made by this press
          withWriter({ kind: 'you', via: 'undo' }, () => ws().trashPage(made.id))
        },
      },
    })
  }
  // the press: the provenance now (the row was written just now by this command; the page as it is)
  void pressPlan(rowId, 'send', { captured: pressProv(ws().pages, rowId) }).then((r) => {
    const id = orderCode(rowId) ?? ''
    if (r.kind === 'refused' && r.why !== 'gone') ui().toast({ message: t('features.coding.order.toast.refused', { id, why: preWhyText(r.why, r.left) }), kind: 'error' })
    if (r.kind === 'kept') ui().toast({ message: t('features.coding.order.toast.kept', { id, why: preWhyText(r.why), time: untilText(Date.now() + ORDER_LIMITS.wantMs) }) })
    // Orders B12 — a team device without the worker link: asked for on the worker device
    if (r.kind === 'asked') ui().toast({ message: t('features.coding.order.toast.asked', { id }) })
  })
  return 'made'
}

/** "Prüfen lassen …": the one-line note first (the dialog in ModalHost), then the request. */
export function sendToOrdersWithNote(pageId: ID): void {
  if (useCloud.getState().readOnly) return
  if (!useCoding.getState().enabled) {
    void sendToOrders(pageId)
    return
  }
  ui().openModal({ type: 'orderNote', pageId })
}

/**
 * A new, empty request (N on #/coding, the key on the database head): a row in Entwurf — it never plans by itself —
 * opened on its own page. The database is made on first use. Null for a viewer.
 */
export function newOrderRequest(writer: Writer = { kind: 'you', via: 'ui' }): ID | null {
  if (useCloud.getState().readOnly) return null
  let made: { id: ID; made: boolean }
  try {
    made = ensureOrderDb(writer)
  } catch {
    return null
  }
  const db = ws().databases[made.id]!
  const read = readOrderConfig(db)
  const statusProp = orderProps(db).status
  const draft = read.kind === 'ok' ? read.config.status.draft : undefined
  const rowId = withWriter(writer, () => ws().createRow(made.id, { properties: statusProp && draft ? { [statusProp]: draft } : {} }))
  if (made.made) ui().toast({ message: t('features.coding.order.settings.made'), kind: 'success' })
  navigate({ name: 'page', id: rowId })
  return rowId
}
