/**
 * Version history: a tape-deck scrubber over all snapshots of a page, a day-grouped list,
 * a block-level diff against the current page, and restore.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JSONContent } from '@tiptap/core'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, History as HistoryIcon, Plus, X } from 'lucide-react'
import { Modal } from '../../ui/Modal'
import { Tooltip } from '../../ui/Tooltip'
import { useLang, useT } from '../../i18n'
import { usePage } from '../../store/selectors'
import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import type { ID } from '../../store/types'
import { ReadOnlyDoc } from '../../editor'
import { countWords, hashContent, listSnapshots, loadSnapshot, onHistoryChange, restoreSnapshot, snapshotNow, type SnapshotBody, type SnapshotMeta } from './snapshots'
import { diffBlocks, diffStats, segments, type DiffSegment } from './diff'
import './history.css'
import '../share/readonly.css'

const MIN_STEP = 56
const MAX_STEP = 132
const PAD = 44
/** approximate advance of one character of the 9.5px mono day label (incl. tracking) */
const DAY_CHAR_W = 6.6

type Item = { kind: 'snap'; meta: SnapshotMeta } | { kind: 'now'; at: number; words: number; blocks: number }

function dayKey(ts: number) {
  const d = new Date(ts)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

export function HistoryModal({ pageId, onClose }: { pageId: ID; onClose: () => void }) {
  const t = useT()
  const lang = useLang()
  const page = usePage(pageId)
  const [metas, setMetas] = useState<SnapshotMeta[] | null>(null)
  const [index, setIndex] = useState<number | null>(null)
  const [mode, setMode] = useState<'changes' | 'version'>('changes')
  const [bodies, setBodies] = useState<Record<ID, SnapshotBody | null>>({})
  const [busy, setBusy] = useState(false)
  const intervalMin = useWorkspace((s) => s.settings.historyIntervalMin)

  const refresh = useCallback(async () => {
    const list = await listSnapshots(pageId)
    setMetas(list)
    return list
  }, [pageId])

  useEffect(() => {
    let alive = true
    // open on the newest version that differs from the page (the newest one is often identical)
    refresh().then((list) => {
      if (!alive) return
      const cur = useWorkspace.getState().pages[pageId]
      const hash = cur ? hashContent(cur.content ?? null, cur.title) : ''
      const differs = list.map((m) => m.hash !== hash).lastIndexOf(true)
      setIndex((i) => i ?? (differs >= 0 ? differs : Math.max(0, list.length - 1)))
    })
    const off = onHistoryChange((id) => id === pageId && void refresh())
    return () => {
      alive = false
      off()
    }
  }, [pageId, refresh])

  const items: Item[] = useMemo(() => {
    const list: Item[] = (metas ?? []).map((meta) => ({ kind: 'snap', meta }))
    list.push({ kind: 'now', at: page?.updatedAt ?? Date.now(), words: countWords(page?.content ?? null), blocks: page?.content?.content?.length ?? 0 })
    return list
  }, [metas, page?.updatedAt, page?.content])

  const sel = index === null ? null : items[Math.min(index, items.length - 1)]
  const selMeta = sel?.kind === 'snap' ? sel.meta : null

  // load the selected snapshot body (and keep a small cache)
  useEffect(() => {
    if (!selMeta || selMeta.id in bodies) return
    let alive = true
    loadSnapshot(selMeta.id)
      .then((b) => alive && setBodies((m) => ({ ...m, [selMeta.id]: b ?? null })))
      .catch(() => alive && setBodies((m) => ({ ...m, [selMeta.id]: null })))
    return () => {
      alive = false
    }
  }, [selMeta, bodies])

  const body = selMeta ? bodies[selMeta.id] : undefined
  const current = page?.content ?? null

  const ops = useMemo(() => (body ? diffBlocks(body.content, current) : []), [body, current])
  const stats = useMemo(() => diffStats(ops), [ops])

  const step = (d: number) => setIndex((i) => Math.max(0, Math.min(items.length - 1, (i ?? 0) + d)))

  // ←/→ anywhere in the dialog (except text fields) moves the playhead
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el?.closest('input, textarea, [contenteditable="true"]')) return
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        if ((el as HTMLElement | null)?.classList?.contains('tape')) return // the tape handles its own keys
        e.preventDefault()
        step(e.key === 'ArrowLeft' ? -1 : 1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }) // eslint-disable-line react-hooks/exhaustive-deps

  const fmtTime = useMemo(() => new Intl.DateTimeFormat(lang === 'de' ? 'de-DE' : 'en-GB', { hour: '2-digit', minute: '2-digit' }), [lang])
  const fmtLong = useMemo(
    () => new Intl.DateTimeFormat(lang === 'de' ? 'de-DE' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    [lang],
  )
  const fmtDay = useMemo(() => new Intl.DateTimeFormat(lang === 'de' ? 'de-DE' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long' }), [lang])
  const fmtNum = useMemo(() => new Intl.NumberFormat(lang === 'de' ? 'de-DE' : 'en-US'), [lang])

  const dayLabel = (ts: number) => {
    const today = dayKey(Date.now())
    const yesterday = dayKey(Date.now() - 86_400_000)
    const k = dayKey(ts)
    return k === today ? t('features.history.today') : k === yesterday ? t('features.history.yesterday') : fmtDay.format(ts)
  }

  const restore = async () => {
    if (!selMeta || busy) return
    setBusy(true)
    try {
      const before = await restoreSnapshot(pageId, selMeta.id)
      useUI.getState().toast({
        message: t('features.history.restored', { time: fmtTime.format(selMeta.at) }),
        kind: 'success',
        action: before ? { label: t('common.undo'), run: () => void restoreSnapshot(pageId, before.id) } : undefined,
      })
      onClose()
    } catch {
      useUI.getState().toast({ message: t('features.history.restoreFailed'), kind: 'error' })
      setBusy(false)
    }
  }

  const saveNow = async () => {
    const meta = await snapshotNow(pageId, 'manual')
    const list = await refresh()
    if (meta) setIndex(list.length - 1)
    useUI.getState().toast({ message: meta ? t('features.history.saved') : t('features.history.unchanged'), kind: meta ? 'success' : 'info' })
  }

  const snapCount = metas?.length ?? 0
  const sinceLabel = (ts: number) => relTime(ts, lang)

  return (
    <Modal open onClose={onClose} bare width={1120} className="hist">
      <header className="hist__head">
        <span className="label hist__sect">§ {t('features.history.label')}</span>
        <h2 className="hist__title">{page?.title?.trim() || t('common.untitled')}</h2>
        <span className="hist__spacer" />
        <button className="btn btn--sm hist__save" onClick={() => void saveNow()}>
          <Plus size={13} strokeWidth={1.8} /> {t('features.history.saveNow')}
        </button>
        <button className="icon-btn hist__close" onClick={onClose} aria-label={t('common.close')}>
          <X size={16} />
        </button>
      </header>

      <Tape items={items} index={index ?? items.length - 1} onChange={setIndex} fmtTime={fmtTime} nowLabel={t('features.history.now')} reasonCode={(r) => t(`features.history.code.${r}`)} />

      <div className="hist__transport">
        <div className="hist__keys" role="group" aria-label={t('features.history.transport')}>
          <Tooltip label={t('features.history.oldest')}>
            <button className="hist__key" onClick={() => setIndex(0)} disabled={!index}>
              <ChevronsLeft size={15} />
            </button>
          </Tooltip>
          <Tooltip label={t('features.history.older')} shortcut="←">
            <button className="hist__key" onClick={() => step(-1)} disabled={!index}>
              <ChevronLeft size={15} />
            </button>
          </Tooltip>
          <Tooltip label={t('features.history.newer')} shortcut="→">
            <button className="hist__key" onClick={() => step(1)} disabled={index === null || index >= items.length - 1}>
              <ChevronRight size={15} />
            </button>
          </Tooltip>
          <Tooltip label={t('features.history.now')}>
            <button className="hist__key" onClick={() => setIndex(items.length - 1)} disabled={index === null || index >= items.length - 1}>
              <ChevronsRight size={15} />
            </button>
          </Tooltip>
        </div>
        <div className="hist__counter mono" aria-live="polite">
          <span className="hist__digits">{String(sel?.kind === 'now' ? snapCount + 1 : (index ?? 0) + 1).padStart(3, '0')}</span>
          <span className="hist__of">/ {String(snapCount + 1).padStart(3, '0')}</span>
        </div>
        <div className="hist__stamp">
          {sel && (
            <>
              <span className="hist__when">{sel.kind === 'now' ? t('features.history.current') : fmtLong.format(sel.meta.at)}</span>
              <span className="label">{sel.kind === 'now' ? t('features.history.liveNow') : `${t(`features.history.reason.${sel.meta.reason}`)} · ${sinceLabel(sel.meta.at)}`}</span>
            </>
          )}
        </div>
        <span className="hist__spacer" />
        {selMeta && (
          <div className="hist__seg" role="tablist">
            <button role="tab" aria-selected={mode === 'changes'} className="hist__seg-btn" onClick={() => setMode('changes')}>
              {t('features.history.changes')}
            </button>
            <button role="tab" aria-selected={mode === 'version'} className="hist__seg-btn" onClick={() => setMode('version')}>
              {t('features.history.version')}
            </button>
          </div>
        )}
      </div>

      <div className="hist__body">
        <aside className="hist__list" aria-label={t('features.history.versions')}>
          {metas === null && <div className="hist__empty-list label">{t('common.loading')}</div>}
          {items
            .map((it, i) => ({ it, i }))
            .reverse()
            .map(({ it, i }, n, arr) => {
              const at = it.kind === 'now' ? Date.now() : it.meta.at
              const prev = arr[n - 1]
              const prevAt = prev ? (prev.it.kind === 'now' ? Date.now() : prev.it.meta.at) : null
              const showDay = prevAt === null || dayKey(prevAt) !== dayKey(at)
              const older = items[i - 1]
              const words = it.kind === 'now' ? it.words : it.meta.words
              const olderWords = older ? (older.kind === 'now' ? older.words : older.meta.words) : null
              const delta = olderWords === null ? null : words - olderWords
              return (
                <div key={it.kind === 'now' ? 'now' : it.meta.id}>
                  {showDay && <div className="hist__day label">{dayLabel(at)}</div>}
                  <button className="hist__row" aria-current={i === index || undefined} onClick={() => setIndex(i)}>
                    <span className="hist__row-time mono">{it.kind === 'now' ? t('features.history.now') : fmtTime.format(it.meta.at)}</span>
                    <span className={`hist__tag hist__tag--${it.kind === 'now' ? 'now' : it.meta.reason}`}>{it.kind === 'now' ? t('features.history.code.now') : t(`features.history.code.${it.meta.reason}`)}</span>
                    <span className="hist__row-spacer" />
                    <span className="hist__row-words mono">{t('features.history.wordsShort', { count: fmtNum.format(words) })}</span>
                    {delta !== null && delta !== 0 && <span className={`hist__delta mono ${delta > 0 ? 'is-up' : 'is-down'}`}>{delta > 0 ? `+${delta}` : `−${-delta}`}</span>}
                  </button>
                </div>
              )
            })}
        </aside>

        <section className="hist__preview" aria-live="polite">
          {sel?.kind === 'now' ? (
            snapCount === 0 && metas !== null ? (
              <div className="hist__empty">
                <HistoryIcon size={22} strokeWidth={1.5} />
                <h3>{t('features.history.emptyTitle')}</h3>
                <p>{t('features.history.emptyBody', { min: intervalMin })}</p>
                <button className="btn" onClick={() => void saveNow()}>
                  <Plus size={14} /> {t('features.history.saveNow')}
                </button>
              </div>
            ) : (
              <div className="hist__doc">
                <div className="hist__banner hist__banner--now label">{t('features.history.currentBanner')}</div>
                <ReadOnlyDoc content={current} />
              </div>
            )
          ) : body === undefined ? (
            <div className="hist__loading label">{t('common.loading')}</div>
          ) : body === null ? (
            <div className="hist__loading label">{t('features.history.missing')}</div>
          ) : mode === 'version' ? (
            <div className="hist__doc">
              {body.title !== (page?.title ?? '') && <h1 className="hist__doc-title">{body.title || t('common.untitled')}</h1>}
              <ReadOnlyDoc content={body.content} />
            </div>
          ) : (
            <div className="hist__doc">
              <div className="hist__banner label">
                {stats.added || stats.removed ? (
                  <>
                    <span>{t('features.history.since')}</span>
                    <span className="hist__legend hist__legend--add">+{stats.added} {t('features.history.added')}</span>
                    <span className="hist__legend hist__legend--rem">−{stats.removed} {t('features.history.removed')}</span>
                  </>
                ) : (
                  <span>{t('features.history.noChanges')}</span>
                )}
              </div>
              {body.title !== (page?.title ?? '') && (
                <div className="hist__title-diff">
                  <span className="label">{t('features.history.titleLabel')}</span>
                  <del>{body.title || t('common.untitled')}</del>
                  <span aria-hidden>→</span>
                  <ins>{page?.title || t('common.untitled')}</ins>
                </div>
              )}
              <DiffView segs={segments(ops)} />
            </div>
          )}
        </section>
      </div>

      <footer className="hist__foot">
        <span className="hist__foot-info mono">
          {selMeta ? t('features.history.footInfo', { words: fmtNum.format(selMeta.words), blocks: selMeta.blocks }) : t('features.history.footHint')}
        </span>
        <span className="hist__spacer" />
        <button className="btn btn--ghost" onClick={onClose}>
          {t('common.close')}
        </button>
        <button className="btn btn--primary" disabled={!selMeta || !body || busy} onClick={() => void restore()}>
          {t('features.history.restore')}
        </button>
      </footer>
    </Modal>
  )
}

function relTime(ts: number, lang: string): string {
  const rtf = new Intl.RelativeTimeFormat(lang === 'de' ? 'de' : 'en', { numeric: 'auto', style: 'short' })
  const s = Math.round((ts - Date.now()) / 1000)
  const abs = Math.abs(s)
  if (abs < 60) return rtf.format(s, 'second')
  if (abs < 3600) return rtf.format(Math.round(s / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(s / 3600), 'hour')
  return rtf.format(Math.round(s / 86400), 'day')
}

/* ------------------------------------------------------------------ */
/* Diff view                                                           */
/* ------------------------------------------------------------------ */

function DiffView({ segs }: { segs: DiffSegment[] }) {
  const t = useT()
  const [open, setOpen] = useState<Set<number>>(new Set())
  return (
    <div className="hdiff">
      {segs.map((s, i) => {
        const doc = (blocks: JSONContent[]): JSONContent => ({ type: 'doc', content: blocks })
        if (s.kind === 'same' && s.blocks.length > 6 && !open.has(i)) {
          const head = i === 0 ? [] : s.blocks.slice(0, 2)
          const tail = i === segs.length - 1 ? [] : s.blocks.slice(-2)
          const hidden = s.blocks.length - head.length - tail.length
          return (
            <div key={i} className="hdiff__seg hdiff__seg--same">
              {head.length > 0 && <ReadOnlyDoc content={doc(head)} />}
              <button className="hdiff__fold" onClick={() => setOpen((o) => new Set(o).add(i))}>
                <span className="hdiff__fold-rule" />
                <span className="label">{t('features.history.unchangedBlocks', { count: hidden })}</span>
                <span className="hdiff__fold-rule" />
              </button>
              {tail.length > 0 && <ReadOnlyDoc content={doc(tail)} />}
            </div>
          )
        }
        const blank = s.blocks.every((b) => b.type === 'paragraph' && !b.content?.length)
        return (
          <div key={i} className={`hdiff__seg hdiff__seg--${s.kind}`}>
            {s.kind !== 'same' && <span className="hdiff__mark mono" aria-label={s.kind === 'added' ? t('features.history.added') : t('features.history.removed')}>{s.kind === 'added' ? '+' : '−'}</span>}
            {blank && s.kind !== 'same' ? <span className="hdiff__blank label">¶ {t('features.history.emptyLines', { count: s.blocks.length })}</span> : <ReadOnlyDoc content={doc(s.blocks)} />}
          </div>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Tape scrubber                                                       */
/* ------------------------------------------------------------------ */

function Tape({
  items,
  index,
  onChange,
  fmtTime,
  nowLabel,
  reasonCode,
}: {
  items: Item[]
  index: number
  onChange: (i: number) => void
  fmtTime: Intl.DateTimeFormat
  nowLabel: string
  reasonCode: (r: string) => string
}) {
  const tapeRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const drag = useRef(false)
  // The tape is the dialog's main control: it takes focus once the modal has settled (the modal
  // focuses its first button one frame after mount), so ← → work at once and Enter saves nothing.
  useEffect(() => {
    let r2 = 0
    const r1 = requestAnimationFrame(() => {
      r2 = requestAnimationFrame(() => {
        const el = tapeRef.current
        const active = document.activeElement
        if (el && (!active || active === document.body || el.closest('.modal')?.contains(active))) el.focus({ preventScroll: true })
      })
    })
    return () => {
      cancelAnimationFrame(r1)
      cancelAnimationFrame(r2)
    }
  }, [])
  const [dragging, setDragging] = useState(false)
  const [viewW, setViewW] = useState(0)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setViewW(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  // spread the marks over the whole tape when there are few of them
  const STEP = items.length > 1 ? Math.max(MIN_STEP, Math.min(MAX_STEP, (viewW - PAD * 2) / (items.length - 1))) : MIN_STEP
  // few versions: anchor the timeline to the right, so "now" always sits at the right edge
  const lead = Math.max(0, viewW - PAD * 2 - Math.max(0, items.length - 1) * STEP)
  const xOf = (i: number) => PAD + lead + i * STEP
  const width = PAD * 2 + lead + Math.max(0, items.length - 1) * STEP

  // bar heights ~ size of each change (a waveform of editing activity)
  const mags = useMemo(() => {
    const raw = items.map((it, i) => {
      const w = it.kind === 'now' ? it.words : it.meta.words
      const b = it.kind === 'now' ? it.blocks : it.meta.blocks
      const prev = items[i - 1]
      if (!prev) return Math.max(4, w * 0.15)
      const pw = prev.kind === 'now' ? prev.words : prev.meta.words
      const pb = prev.kind === 'now' ? prev.blocks : prev.meta.blocks
      return Math.abs(w - pw) + Math.abs(b - pb) * 6
    })
    const max = Math.max(1, ...raw)
    return raw.map((r) => Math.sqrt(r / max))
  }, [items])

  // keep the playhead in view
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const x = xOf(index)
    if (x < el.scrollLeft + 60 || x > el.scrollLeft + el.clientWidth - 60) el.scrollTo({ left: x - el.clientWidth / 2, behavior: drag.current ? 'auto' : 'smooth' })
  }, [index, items.length, STEP, lead]) // eslint-disable-line react-hooks/exhaustive-deps

  const fromX = (clientX: number) => {
    const r = trackRef.current!.getBoundingClientRect()
    return Math.max(0, Math.min(items.length - 1, Math.round((clientX - r.left - PAD - lead) / STEP)))
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    drag.current = true
    setDragging(true)
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    onChange(fromX(e.clientX))
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return
    const el = scrollRef.current!
    const r = el.getBoundingClientRect()
    if (e.clientX < r.left + 30) el.scrollLeft -= 12
    else if (e.clientX > r.right - 30) el.scrollLeft += 12
    const i = fromX(e.clientX)
    if (i !== index) onChange(i)
  }
  const endDrag = () => {
    drag.current = false
    setDragging(false)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    const map: Record<string, number> = { ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: items.length - 1, PageUp: index - 5, PageDown: index + 5 }
    if (e.key in map) {
      e.preventDefault()
      onChange(Math.max(0, Math.min(items.length - 1, map[e.key])))
    }
  }

  const sel = items[index]
  const selAt = sel ? (sel.kind === 'now' ? Date.now() : sel.meta.at) : Date.now()
  const headX = xOf(index)
  const lang = useLang()
  const fmtDay = useMemo(() => new Intl.DateTimeFormat(lang === 'de' ? 'de-DE' : 'en-GB', { day: '2-digit', month: 'short' }), [lang])

  return (
    <div
      ref={tapeRef}
      className="tape"
      tabIndex={0}
      data-autofocus=""
      role="slider"
      aria-valuemin={1}
      aria-valuemax={items.length}
      aria-valuenow={index + 1}
      aria-valuetext={sel?.kind === 'now' ? nowLabel : fmtTime.format(selAt)}
      onKeyDown={onKeyDown}
      data-dragging={dragging || undefined}
    >
      <div className="tape__window" ref={scrollRef}>
        <div
          className="tape__track"
          ref={trackRef}
          style={{ width: `max(100%, ${width}px)`, ['--step' as string]: `${STEP}px`, ['--pad' as string]: `${PAD + lead}px` }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <div className="tape__ruler" />
          {items.map((it, i) => {
            const at = it.kind === 'now' ? Date.now() : it.meta.at
            const prev = items[i - 1]
            const prevAt = prev ? (prev.kind === 'now' ? Date.now() : prev.meta.at) : null
            const splice = prevAt !== null && dayKey(prevAt) !== dayKey(at)
            const x = xOf(i)
            const day = fmtDay.format(at).toUpperCase()
            const spliceX = i === 0 ? (lead > 0 ? x : 8) : x - STEP / 2
            // the label steps aside (fades) while the playhead cap passes over it
            const w = day.length * DAY_CHAR_W
            const [l0, l1] = i === 0 && lead > 0 ? [spliceX - 12 - w, spliceX - 12] : [spliceX + 5, spliceX + 5 + w]
            const covered = headX + 9 > l0 && headX - 9 < l1
            return (
              <div key={it.kind === 'now' ? 'now' : it.meta.id}>
                {(splice || i === 0) && (
                  <div className="tape__splice" style={{ left: spliceX }} data-first={i === 0 || undefined} data-right={(i === 0 && lead > 0) || undefined}>
                    <span className="tape__day mono" data-covered={covered || undefined}>
                      {day}
                    </span>
                  </div>
                )}
                <div className={`tape__mark${it.kind === 'now' ? ' tape__mark--now' : ''}`} data-sel={i === index || undefined} style={{ left: x }}>
                  {it.kind === 'snap' && it.meta.reason !== 'auto' && <span className="tape__glyph mono">{reasonCode(it.meta.reason).charAt(0)}</span>}
                  <span className="tape__bar" style={{ height: `${8 + mags[i] * 22}px` }} />
                  <span className="tape__time mono">{it.kind === 'now' ? nowLabel : fmtTime.format(at)}</span>
                </div>
              </div>
            )
          })}
          <div className="tape__head" style={{ left: xOf(index) }} aria-hidden>
            <span className="tape__head-cap" />
          </div>
        </div>
      </div>
    </div>
  )
}
