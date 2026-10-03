/**
 * "Link as relation?" — a row's text @-mentions (or links to) a row of another database (the editor
 * announces both with the window event PAGE_MENTIONED). A small chip next to the mention offers to
 * put that row into a relation: the existing relation to that database, or a new one through the
 * short relation dialog (two-way by default). Alt+Enter (⌥↵) moves focus into the chip, Esc goes
 * back to writing; the chip leaves by itself after a while. × stops asking for this pair of
 * databases on this device. Never offered to viewers, nor to create on a locked database.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { autoUpdate, flip, hide, offset, shift, useFloating } from '@floating-ui/react'
import { ArrowUpRight, X } from 'lucide-react'
import type { ID } from '../../store/types'
import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import { pageTitle } from '../../store/selectors'
import { Kbd, shortcutLabel } from '../../ui/controls'
import { t as translate, useT } from '../../i18n'
import { safeLocalGet, safeLocalSet } from '@/shared/brand'
import { isDbReadOnly } from '../readonly'
import { writeValue } from '../model/actions'
import { canCreateProperties } from './quick'
import { openCreateProperty } from './state'

/** Window event the editor dispatches after inserting a page mention or a link to a page: detail { from: page id, to: page id }. */
export const PAGE_MENTIONED = 'one:page-mentioned'

const OFF_KEY = 'one.db.relationOffer.off'
const LINGER_MS = 15_000

const ws = () => useWorkspace.getState()
const pairKey = (dbId: ID, targetDbId: ID) => `${dbId}>${targetDbId}`

function offPairs(): string[] {
  try {
    const v: unknown = JSON.parse(safeLocalGet(OFF_KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function setOff(key: string): void {
  try {
    safeLocalSet(OFF_KEY, JSON.stringify([...offPairs().filter((k) => k !== key), key].slice(-200)))
  } catch {
    /* per-device convenience only */
  }
}

export interface RelationOfferInfo {
  targetId: ID
  targetDbId: ID
  /** The existing relation property to that database (null: one would be created). */
  relId: ID | null
}

/** What to offer when row `rowId` mentions page `targetId` (null: nothing). */
export function relationOfferFor(rowId: ID, targetId: ID, opts: { ignoreOff?: boolean } = {}): RelationOfferInfo | null {
  if (isDbReadOnly()) return null
  const s = ws()
  const row = s.pages[rowId]
  const target = s.pages[targetId]
  const dbId = row?.databaseId
  const db = dbId ? s.databases[dbId] : undefined
  const targetDbId = target?.databaseId
  if (!row || !db || !dbId || !target || target.trashed || !targetDbId || targetDbId === dbId || !s.databases[targetDbId]) return null
  if (!opts.ignoreOff && offPairs().includes(pairKey(dbId, targetDbId))) return null
  const rel = db.properties.find((p) => p.type === 'relation' && p.relationDatabaseId === targetDbId)
  if (rel) {
    const cur = row.properties[rel.id]
    return Array.isArray(cur) && cur.includes(targetId) ? null : { targetId, targetDbId, relId: rel.id }
  }
  return canCreateProperties(dbId) ? { targetId, targetDbId, relId: null } : null
}

/** The mention's (or link's) element in this row's editor (the last one). */
function mentionEl(rowId: ID, targetId: ID): HTMLElement | null {
  const editor = document.querySelector(`.ProseMirror[data-page-id="${CSS.escape(rowId)}"]`)
  const all = editor?.querySelectorAll<HTMLElement>(`a[href="#/p/${CSS.escape(targetId)}"]`)
  return all?.length ? all[all.length - 1] : null
}

/** Put the mentioned row into the relation, or ask how to create one. */
function acceptOffer(rowId: ID, o: RelationOfferInfo): void {
  const s = ws()
  const dbId = s.pages[rowId]?.databaseId
  const db = dbId ? s.databases[dbId] : undefined
  if (!db || !dbId) return
  const rel = o.relId ? db.properties.find((p) => p.id === o.relId) : undefined
  const untitled = translate('common.untitled')
  if (rel) {
    const before = ((s.pages[rowId]?.properties[rel.id] as ID[] | undefined) ?? []).slice()
    writeValue(dbId, rel, rowId, [...before, o.targetId])
    return void useUI.getState().toast({
      message: translate('database.offer.linked', { title: pageTitle(s.pages[o.targetId], untitled), prop: rel.name }),
      action: { label: translate('common.undo'), run: () => writeValue(dbId, rel, rowId, before) },
    })
  }
  openCreateProperty({
    dbId,
    type: 'relation',
    types: ['relation'],
    relationDatabaseId: o.targetDbId,
    lockTarget: true,
    name: pageTitle(s.pages[o.targetDbId], untitled),
    onCreated: (prop) => writeValue(dbId, prop, rowId, [o.targetId]),
  })
}

export function RelationOffer({ rowId }: { rowId: ID }) {
  const t = useT()
  const [offer, setOffer] = useState<(RelationOfferInfo & { rev: number }) | null>(null)
  const [hold, setHold] = useState(false)
  const anchorRef = useRef<HTMLSpanElement>(null)
  const linkRef = useRef<HTMLButtonElement>(null)
  const returnTo = useRef<HTMLElement | null>(null)
  const rev = useWorkspace((s) => s.pages[rowId]?.contentRev ?? 0)
  const props = useWorkspace((s) => s.pages[rowId]?.properties)

  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ from?: unknown; to?: unknown }>).detail
      if (!d || d.from !== rowId || typeof d.to !== 'string') return
      const next = relationOfferFor(rowId, d.to)
      if (next) setOffer({ ...next, rev: ws().pages[rowId]?.contentRev ?? 0 })
    }
    window.addEventListener(PAGE_MENTIONED, on)
    return () => window.removeEventListener(PAGE_MENTIONED, on)
  }, [rowId])

  // linked meanwhile, the mention deleted again (undo) …: the offer is over
  useEffect(() => {
    if (!offer) return
    const page = ws().pages[rowId]
    // (a mention carries the id, a link "#/p/<id>")
    const gone = offer.rev !== rev && !JSON.stringify(page?.content ?? null).includes(offer.targetId)
    if (gone || !relationOfferFor(rowId, offer.targetId, { ignoreOff: true })) setOffer(null)
  }, [rev, props]) // eslint-disable-line react-hooks/exhaustive-deps

  // it doesn't stay around: gone after a while unless hovered or focused
  useEffect(() => {
    if (!offer || hold) return
    const id = window.setTimeout(() => setOffer(null), LINGER_MS)
    return () => window.clearTimeout(id)
  }, [offer, hold])

  // ⌥↵ / Alt+Enter: into the chip (from the editor or anywhere else)
  useEffect(() => {
    if (!offer) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || !e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return
      e.preventDefault()
      e.stopPropagation()
      returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      linkRef.current?.focus()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [offer])

  const { refs, floatingStyles, middlewareData } = useFloating({
    strategy: 'fixed',
    placement: 'bottom-start',
    middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 }), hide()],
    whileElementsMounted: (ref, floating, update) => autoUpdate(ref, floating, update, { animationFrame: true }),
  })
  useLayoutEffect(() => {
    if (!offer) return
    let last = anchorRef.current?.getBoundingClientRect() ?? new DOMRect()
    const editor = document.querySelector(`.ProseMirror[data-page-id="${CSS.escape(rowId)}"]`) ?? undefined
    refs.setPositionReference({
      contextElement: editor,
      getBoundingClientRect: () => {
        // the mention's node view renders a moment after the insert; until then: the property panel
        const el = mentionEl(rowId, offer.targetId) ?? anchorRef.current
        if (el?.isConnected) last = el.getBoundingClientRect()
        return last
      },
    })
  }, [offer, rowId, refs])

  const backToWriting = () => {
    const el = returnTo.current?.isConnected ? returnTo.current : document.querySelector<HTMLElement>(`.ProseMirror[data-page-id="${CSS.escape(rowId)}"]`)
    returnTo.current = null
    el?.focus({ preventScroll: true })
  }
  const close = () => {
    setOffer(null)
    setHold(false)
  }
  const accept = () => {
    if (!offer) return
    const o = offer
    close()
    // focus goes back first: the relation dialog returns it there when it closes
    backToWriting()
    acceptOffer(rowId, o)
  }
  const dismiss = () => {
    if (!offer) return
    const dbId = ws().pages[rowId]?.databaseId
    if (dbId) setOff(pairKey(dbId, offer.targetDbId))
    close()
    backToWriting()
  }

  const s = ws()
  const dbName = offer ? pageTitle(s.pages[offer.targetDbId], t('common.untitled')) : ''
  const rel = offer?.relId ? s.databases[s.pages[rowId]?.databaseId ?? '']?.properties.find((p) => p.id === offer.relId) : undefined
  const text = !offer ? '' : rel ? t('database.offer.add', { prop: rel.name }) : t('database.offer.create', { db: dbName })
  const keys = shortcutLabel('Alt+↵')

  return (
    <>
      <span ref={anchorRef} className="dbc-offer__anchor" aria-hidden />
      <span className="visually-hidden" role="status">
        {offer ? `${text} ${t('database.offer.keys', { keys })}` : ''}
      </span>
      {offer &&
        createPortal(
          <div
            ref={refs.setFloating}
            className="dbc-offer"
            role="group"
            aria-label={text}
            data-testid="relation-offer"
            style={{ ...floatingStyles, visibility: middlewareData.hide?.referenceHidden ? 'hidden' : undefined }}
            onMouseEnter={() => setHold(true)}
            onMouseLeave={() => setHold(false)}
            onFocus={() => setHold(true)}
            onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setHold(false)}
            onKeyDown={(e) => {
              if (e.key !== 'Escape') return
              e.preventDefault()
              e.stopPropagation()
              backToWriting()
            }}
          >
            <span className="dbc-offer__tag label" aria-hidden>
              <ArrowUpRight size={11} strokeWidth={2.2} />
              {t('database.offer.tag')}
            </span>
            <span className="dbc-offer__text">{text}</span>
            <button ref={linkRef} type="button" className="btn btn--sm btn--primary dbc-offer__go" onClick={accept}>
              {rel ? t('database.offer.addBtn') : t('database.offer.link')}
              <Kbd>{keys}</Kbd>
            </button>
            <button type="button" className="icon-btn icon-btn--sm dbc-offer__x" aria-label={t('database.offer.dismiss', { db: dbName })} title={t('database.offer.dismiss', { db: dbName })} onClick={dismiss}>
              <X size={13} />
            </button>
          </div>,
          document.body,
        )}
    </>
  )
}
