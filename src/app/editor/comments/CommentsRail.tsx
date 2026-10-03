/**
 * Comments (margin notes) of one editor.
 *  - wide layouts (scroll column ≥ MARGIN_MIN): a rail in the right margin, every card at the
 *    height of its anchor, stacked without overlap; the focused card sits exactly at its anchor.
 *    The page column moves left to make room (editor.css → comments.css, [data-rail]).
 *  - narrow layouts: a one-line summary above the text opens a sheet (right panel / bottom sheet).
 * Clicking highlighted text focuses its thread and vice versa. Threads whose text is gone are
 * "detached" and keep their quote. Threads live on the page (store); UI state on the bridge.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Editor } from '@tiptap/core'
import type { EditorView } from '@tiptap/pm/view'
import { useStore } from 'zustand'
import { MessageSquareText, X } from 'lucide-react'
import { Switch } from '../../ui/controls'
import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import type { PageComment } from '../../store/types'
import { useT } from '../../i18n'
import type { Bridge, CommentsUI } from '../lib/bridge'
import { revealPos } from '../schema/tabs'
import { anchorDraft, anchorRanges, commentsKey, dropDraft, removeAnchors, syncComments } from './plugin'
import { Composer, ThreadCard } from './ThreadCard'
import './comments.css'

/** Width of the scroll column from which the rail sits in the margin. */
const MARGIN_MIN = 1120
const GAP = 8
const HEAD = 34
/** Layout key of the draft card. */
const DRAFT = '\u0000draft'

const EMPTY: PageComment[] = []

function validThreads(raw: unknown): PageComment[] {
  if (!Array.isArray(raw)) return EMPTY
  return raw.filter((c): c is PageComment => !!c && typeof c === 'object' && typeof c.id === 'string' && typeof c.body === 'string')
}

/** Closest scrolling ancestor (the page column). */
function scrollHost(el: HTMLElement | null): HTMLElement | null {
  for (let p = el?.parentElement ?? null; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY
    if (o === 'auto' || o === 'scroll') return p
  }
  return null
}

/** Top of an anchor relative to `top`. Text in a hidden tab / closed toggle: its visible container. */
function anchorTop(view: EditorView, pos: number, top: number): { y: number; hidden: boolean } | null {
  try {
    const { node } = view.domAtPos(pos)
    let el: Element | null = node.nodeType === 3 ? node.parentElement : (node as Element)
    if (el && el.getClientRects().length) return { y: view.coordsAtPos(pos).top - top, hidden: false }
    while (el && el !== view.dom && !el.getClientRects().length) el = el.parentElement
    if (!el || el === view.dom) return null
    return { y: el.getBoundingClientRect().top - top, hidden: true }
  } catch {
    return null
  }
}

function setUI(bridge: Bridge, patch: Partial<CommentsUI>) {
  bridge.setState((s) => ({ comments: { ...s.comments, ...patch } }))
}

/** Layout mode from the width of the page column. */
function useMode(host: HTMLElement | null): 'margin' | 'sheet' {
  const [mode, setMode] = useState<'margin' | 'sheet'>('sheet')
  useEffect(() => {
    const el = scrollHost(host)
    if (!el) return
    const measure = () => setMode(el.clientWidth >= MARGIN_MIN ? 'margin' : 'sheet')
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [host])
  return mode
}

export function Comments({ editor, bridge, pageId }: { editor: Editor; bridge: Bridge; pageId: string }) {
  const t = useT()
  const ui = useStore(bridge, (s) => s.comments)
  const raw = useWorkspace((s) => s.pages[pageId]?.comments)
  const threads = useMemo(() => validThreads(raw), [raw])
  const locked = useWorkspace((s) => !!s.pages[pageId]?.settings.locked)
  const canEdit = !locked && editor.isEditable
  const host = editor.view.dom.closest('.one-editor') as HTMLElement | null
  const mode = useMode(host)

  // anchors follow the document
  const [docRev, setDocRev] = useState(0)
  const [layoutRev, setLayoutRev] = useState(0)
  useEffect(() => {
    let raf = 0
    const bump = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => setLayoutRev((n) => n + 1))
    }
    const onTr = ({ transaction }: { transaction: { docChanged: boolean } }) => {
      if (transaction.docChanged) setDocRev((n) => n + 1)
      bump()
    }
    editor.on('transaction', onTr)
    const ro = new ResizeObserver(bump)
    ro.observe(editor.view.dom)
    window.addEventListener('resize', bump)
    return () => {
      cancelAnimationFrame(raf)
      editor.off('transaction', onTr)
      ro.disconnect()
      window.removeEventListener('resize', bump)
    }
  }, [editor])
  const anchors = useMemo(() => (editor.isDestroyed ? new Map<string, { from: number; to: number }>() : anchorRanges(editor.state.doc)), [editor, docRev]) // eslint-disable-line react-hooks/exhaustive-deps

  // thread states → highlight decorations
  const resolvedMap = useMemo(() => Object.fromEntries(threads.map((c) => [c.id, !!c.resolved])), [threads])
  useEffect(() => {
    syncComments(editor.view, { threads: resolvedMap, active: ui.active, showResolved: ui.showResolved })
  }, [editor, resolvedMap, ui.active, ui.showResolved])

  // a draft whose range vanished (its text was deleted before saving) is dropped
  useEffect(() => {
    if (ui.draft && !commentsKey.getState(editor.state)?.draft) setUI(bridge, { draft: null, active: ui.active === ui.draft.id ? null : ui.active })
  }, [docRev]) // eslint-disable-line react-hooks/exhaustive-deps

  // the wide layout has no sheet
  useEffect(() => {
    if (mode === 'margin' && ui.panel) setUI(bridge, { panel: false })
  }, [mode, ui.panel, bridge])

  // shell / other areas: window.dispatchEvent(new CustomEvent('one:comments', { detail: { pageId } }))
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ pageId?: string; open?: boolean }>).detail
      if (d?.pageId && d.pageId !== pageId) return
      const s = bridge.getState().comments
      const open = d?.open ?? !s.panel
      setUI(bridge, { panel: open, showResolved: s.showResolved || (open && !threads.some((c) => !c.resolved)) })
    }
    window.addEventListener('one:comments', on)
    return () => window.removeEventListener('one:comments', on)
  }, [bridge, pageId, threads])

  const open = threads.filter((c) => !c.resolved)
  const resolvedCount = threads.length - open.length
  const visible = threads.filter((c) => !c.resolved || ui.showResolved)
  const byPos = (a: PageComment, b: PageComment) => {
    const pa = anchors.get(a.id)?.from ?? Infinity
    const pb = anchors.get(b.id)?.from ?? Infinity
    return pa - pb || a.createdAt - b.createdAt
  }
  const ordered = [...visible].sort(byPos)
  const draftState = ui.draft && ui.draft.id === commentsKey.getState(editor.state)?.draft?.id ? ui.draft : null

  /* ---------------- actions ---------------- */

  const activate = useCallback(
    (id: string | null, opts: { scroll?: boolean } = {}) => {
      setUI(bridge, { active: id, via: 'rail' })
      if (!id || editor.isDestroyed) return
      const a = anchorRanges(editor.state.doc).get(id)
      if (!a) return
      revealPos(editor.view, a.from)
      if (opts.scroll) {
        const { node } = editor.view.domAtPos(a.from)
        const el = node.nodeType === 3 ? node.parentElement : (node as Element)
        el?.scrollIntoView?.({ block: window.innerWidth < 640 ? 'start' : 'center', behavior: 'smooth' })
      }
    },
    [bridge, editor],
  )

  const submitDraft = (body: string) => {
    const d = ui.draft
    if (!d) return
    const range = anchorDraft(editor)
    if (range) useWorkspace.getState().addComment(pageId, { id: d.id, quote: d.quote, body })
    setUI(bridge, { draft: null, active: range ? d.id : null, via: 'rail' })
    if (mode === 'margin') editor.commands.focus()
  }

  const cancelDraft = () => {
    dropDraft(editor)
    setUI(bridge, { draft: null, active: null })
    if (!editor.isDestroyed) editor.commands.focus()
  }

  const deleteThread = (c: PageComment) => {
    const run = () => {
      removeAnchors(editor, c.id)
      useWorkspace.getState().deleteComment(pageId, c.id)
      if (bridge.getState().comments.active === c.id) setUI(bridge, { active: null })
    }
    if (!c.replies?.length) return run()
    useUI.getState().openModal({ type: 'confirm', title: t('editor.comments.deleteTitle'), body: t('editor.comments.deleteBody', { count: c.replies.length }), danger: true, confirmLabel: t('common.delete'), onConfirm: run })
  }

  const closeSheet = () => {
    setUI(bridge, { panel: false })
    if (!editor.isDestroyed && editor.isEditable) editor.commands.focus()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return
    e.preventDefault()
    if (draftState) return cancelDraft()
    if (mode === 'sheet') return closeSheet()
    setUI(bridge, { active: null })
    if (!editor.isDestroyed) editor.commands.focus()
  }

  /* ---------------- margin layout ---------------- */

  const railRef = useRef<HTMLDivElement>(null)
  const cardEls = useRef(new Map<string, HTMLElement>())
  const [tops, setTops] = useState<Record<string, number>>({})
  const [hiddenAnchors, setHiddenAnchors] = useState<Record<string, boolean>>({})
  const railOn = mode === 'margin' && (visible.length > 0 || !!draftState)

  useEffect(() => {
    if (!host) return
    if (railOn) host.dataset.rail = 'margin'
    else delete host.dataset.rail
    return () => {
      delete host.dataset.rail
    }
  }, [host, railOn])

  useLayoutEffect(() => {
    const rail = railRef.current
    if (!railOn || !rail || editor.isDestroyed) return
    const top = rail.getBoundingClientRect().top
    const view = editor.view
    const items: Array<{ id: string; y: number; h: number }> = []
    const hiddenNow: Record<string, boolean> = {}
    const pmDraft = commentsKey.getState(editor.state)?.draft
    if (draftState && pmDraft) {
      const a = anchorTop(view, pmDraft.from, top)
      items.push({ id: DRAFT, y: a?.y ?? HEAD, h: cardEls.current.get(DRAFT)?.offsetHeight ?? 120 })
    }
    const detached: Array<{ id: string; h: number }> = []
    for (const c of ordered) {
      const h = cardEls.current.get(c.id)?.offsetHeight ?? 96
      const r = anchors.get(c.id)
      const a = r ? anchorTop(view, r.from, top) : null
      if (!a) {
        detached.push({ id: c.id, h })
        continue
      }
      if (a.hidden) hiddenNow[c.id] = true
      items.push({ id: c.id, y: a.y, h })
    }
    items.sort((x, y) => x.y - y.y)
    const pos: Record<string, number> = {}
    const focus = items.findIndex((it) => it.id === (draftState ? DRAFT : ui.active))
    const place = (from: number) => {
      for (let i = from; i < items.length; i++) {
        const prev = i > 0 ? pos[items[i - 1].id] + items[i - 1].h + GAP : HEAD
        pos[items[i].id] = Math.max(items[i].y, prev, HEAD)
      }
    }
    if (focus >= 0) {
      pos[items[focus].id] = Math.max(items[focus].y, HEAD)
      place(focus + 1)
      for (let i = focus - 1; i >= 0; i--) pos[items[i].id] = Math.min(items[i].y, pos[items[i + 1].id] - items[i].h - GAP)
      // pushed above the rail head: settle downwards from the top
      if (focus > 0 && pos[items[0].id] < HEAD) {
        pos[items[0].id] = HEAD
        for (let i = 1; i < items.length; i++) pos[items[i].id] = Math.max(pos[items[i].id], pos[items[i - 1].id] + items[i - 1].h + GAP)
      }
    } else place(0)
    let y = items.length ? Math.max(...items.map((it) => pos[it.id] + it.h)) + GAP * 3 : HEAD
    for (const d of detached) {
      pos[d.id] = y
      y += d.h + GAP
    }
    setTops((old) => (JSON.stringify(old) === JSON.stringify(pos) ? old : pos))
    setHiddenAnchors((old) => (JSON.stringify(old) === JSON.stringify(hiddenNow) ? old : hiddenNow))
  })

  // card heights change (replies, editing): lay out again
  useEffect(() => {
    if (!railOn) return
    let raf = 0
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => setLayoutRev((n) => n + 1))
    })
    cardEls.current.forEach((el) => ro.observe(el))
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  })
  void layoutRev

  const cardRef = (id: string) => (el: HTMLElement | null) => {
    if (el) cardEls.current.set(id, el)
    else cardEls.current.delete(id)
  }

  /* ---------------- render ---------------- */

  const draftCard = draftState && (
    <div ref={cardRef(DRAFT)} className="ccard ccard--draft is-active" style={mode === 'margin' ? { top: tops[DRAFT] ?? HEAD } : undefined} data-thread-card="draft">
      {mode === 'sheet' && <blockquote className="ccard__quote">{draftState.quote}</blockquote>}
      <Composer label={t('editor.comments.composerLabel')} placeholder={t('editor.comments.placeholder')} submitLabel={t('editor.comments.comment')} autoFocus onCancel={cancelDraft} onSubmit={submitDraft} onEmptyBlur={mode === 'margin' ? cancelDraft : undefined} />
    </div>
  )

  const cards = (inSheet: boolean) =>
    ordered.map((c) => (
      <ThreadCard
        key={c.id}
        ref={inSheet ? undefined : cardRef(c.id)}
        pageId={pageId}
        thread={c}
        active={ui.active === c.id}
        detached={!anchors.has(c.id)}
        hidden={!inSheet && !!hiddenAnchors[c.id]}
        showQuote={inSheet}
        canEdit={canEdit}
        style={inSheet ? undefined : { top: tops[c.id] ?? HEAD }}
        onActivate={() => activate(c.id, { scroll: inSheet })}
        onLocate={inSheet ? () => activate(c.id, { scroll: true }) : undefined}
        onDelete={() => deleteThread(c)}
      />
    ))

  const head = (inSheet: boolean) => (
    <div className={inSheet ? 'csheet__head' : 'crail__head'}>
      <span className="label crail__title">
        {t('editor.comments.title')} · {t('editor.comments.openCount', { count: open.length })}
      </span>
      {resolvedCount > 0 && (
        <label className="crail__toggle label">
          <Switch checked={ui.showResolved} onChange={(v) => setUI(bridge, { showResolved: v })} label={t('editor.comments.showResolved')} />
          <span aria-hidden>{t('editor.comments.resolvedCount', { count: resolvedCount })}</span>
        </label>
      )}
      {inSheet && (
        <button type="button" className="ctool" aria-label={t('common.close')} title={t('common.close')} onClick={closeSheet}>
          <X size={15} strokeWidth={1.75} />
        </button>
      )}
    </div>
  )

  const showSummary = threads.length > 0 && (mode === 'sheet' || (!railOn && resolvedCount > 0))
  const summary = showSummary && (
    <div className="csummary">
      <MessageSquareText size={14} strokeWidth={1.75} aria-hidden />
      <span className="label">
        {t('editor.comments.title')} — {t('editor.comments.openCount', { count: open.length })}
        {resolvedCount > 0 && ` · ${t('editor.comments.resolvedCount', { count: resolvedCount })}`}
      </span>
      <button
        type="button"
        className="csummary__btn"
        aria-expanded={mode === 'sheet' ? ui.panel : ui.showResolved}
        onClick={() => (mode === 'sheet' ? setUI(bridge, { panel: !ui.panel, showResolved: ui.showResolved || !open.length }) : setUI(bridge, { showResolved: true }))}
      >
        {mode === 'sheet' ? t(ui.panel ? 'editor.comments.hide' : 'editor.comments.view') : t('editor.comments.showResolved')}
      </button>
    </div>
  )

  const sheetOn = mode === 'sheet' && ui.panel && (threads.length > 0 || !!draftState)

  return (
    <>
      {summary}
      {railOn && (
        <div ref={railRef} className="crail" role="complementary" aria-label={t('editor.comments.title')} onKeyDown={onKeyDown}>
          {head(false)}
          {draftCard}
          {cards(false)}
        </div>
      )}
      {sheetOn &&
        createPortal(
          <div className="csheet" role="dialog" aria-modal="false" aria-label={t('editor.comments.title')} onKeyDown={onKeyDown}>
            {head(true)}
            <div className="csheet__list">
              {draftCard}
              {cards(true)}
              {!ordered.length && !draftState && <p className="csheet__empty label">{t('editor.comments.noneOpen')}</p>}
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
