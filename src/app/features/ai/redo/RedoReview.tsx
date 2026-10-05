/**
 * "Redo with instructions" — the review in the AI panel: one passage at a time ("PASSAGE 2/5"), before →
 * after as a word diff (removed words struck through, added ones underlined in signal), keys:
 * Enter / y accept, n / d reject, j / k next / previous, a accept all, Esc closes (the run stays).
 * Once every passage is decided, Enter applies the accepted ones in one step (apply.ts).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { Check, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { Kbd } from '../../../ui/controls'
import { useT } from '../../../i18n'
import { useUI } from '../../../store/ui'
import type { ID } from '../../../store/types'
import { decideAllRedo, removeRun, setRedoDecision, setRedoOutcome, type AIRun, type RedoItem } from '../runs'
import { readable, type RedoPassage } from './passages'
import { diffCounts, wordDiff } from './diff'
import { applyRedo } from './apply'
import './redo.css'

export interface RedoReviewProps {
  run: AIRun
  editor: Editor
  pageId: ID
  /** the review is over (applied / nothing to apply): the panel closes */
  onDone: () => void
}

type Row = { p: RedoPassage; item: RedoItem }

export function RedoReview({ run, editor, pageId, onDone }: RedoReviewProps) {
  const t = useT()
  const rootRef = useRef<HTMLDivElement>(null)
  const req = run.req.kind === 'redo' ? run.req : null
  const rows: Row[] = useMemo(() => {
    if (!req || !run.redo) return []
    return req.passages.map((p) => ({ p, item: run.redo!.items.find((x) => x.n === p.n) ?? { n: p.n, after: null, decision: null } }))
  }, [req, run.redo])
  const decidable = rows.filter((r) => r.item.after !== null)
  const firstOpen = Math.max(0, rows.findIndex((r) => r.item.after !== null && !r.item.decision))
  const [at, setAt] = useState(firstOpen)
  const [busy, setBusy] = useState(false)
  const applied = rows.some((r) => r.item.outcome)
  const allDecided = decidable.every((r) => r.item.decision)
  const accepted = rows.filter((r) => r.item.decision === 'accept' && r.item.after !== null && !r.item.outcome)
  const rejected = rows.filter((r) => r.item.decision === 'reject').length
  const cur = rows[Math.min(at, rows.length - 1)]

  // the keyboard comes here when the result is in
  useEffect(() => {
    const id = requestAnimationFrame(() => rootRef.current?.focus({ preventScroll: true }))
    return () => cancelAnimationFrame(id)
  }, [])

  const nextOpen = useCallback(
    (from: number) => {
      for (let k = 1; k <= rows.length; k++) {
        const i = (from + k) % rows.length
        if (rows[i].item.after !== null && !rows[i].item.decision) return i
      }
      return from
    },
    [rows],
  )

  const decide = (d: 'accept' | 'reject') => {
    if (!cur || cur.item.after === null || applied) return
    setRedoDecision(run.id, cur.p.n, d)
    setAt(nextOpen(at))
  }

  const apply = async () => {
    if (busy) return
    if (!accepted.length) {
      removeRun(run.id)
      onDone()
      return
    }
    setBusy(true)
    const res = await applyRedo(
      editor,
      pageId,
      accepted.map((r) => ({ passage: r.p, after: r.item.after! })),
    )
    setBusy(false)
    const outcome: Record<number, 'applied' | 'changed'> = {}
    res.applied.forEach((n) => (outcome[n] = 'applied'))
    res.changed.forEach((n) => (outcome[n] = 'changed'))
    const parts = [res.applied.length ? t(`features.ai.redo.applied.${res.applied.length === 1 ? 'one' : 'other'}`, { count: res.applied.length }) : '']
    if (res.changed.length) parts.push(t(`features.ai.redo.changedNote.${res.changed.length === 1 ? 'one' : 'other'}`, { count: res.changed.length }))
    useUI.getState().toast({ message: parts.filter(Boolean).join(' · '), kind: res.changed.length ? 'info' : 'success' })
    if (!res.changed.length) {
      removeRun(run.id)
      onDone()
      return
    }
    setRedoOutcome(run.id, outcome)
    setAt(Math.max(0, rows.findIndex((r) => outcome[r.p.n] === 'changed')))
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.nativeEvent.isComposing) return
    const k = e.key
    let handled = true
    if (k === 'j' || k === 'ArrowDown' || k === 'ArrowRight') setAt((a) => Math.min(rows.length - 1, a + 1))
    else if (k === 'k' || k === 'ArrowUp' || k === 'ArrowLeft') setAt((a) => Math.max(0, a - 1))
    else if (applied && (k === 'Enter' || k === ' ')) {
      removeRun(run.id)
      onDone()
    } else if (k === 'y' || (k === 'Enter' && !allDecided)) decide('accept')
    else if (k === 'n' || k === 'd') decide('reject')
    else if (k === 'a' && !applied) decideAllRedo(run.id, 'accept')
    else if (k === 'Enter' && allDecided) void apply()
    else handled = false
    if (handled) {
      e.preventDefault()
      e.stopPropagation()
    }
  }

  if (!req || !cur) return null
  const state = cur.item.outcome ?? (cur.item.after === null ? 'skip' : (cur.item.decision ?? 'open'))
  const before = readable(cur.p.markdown || cur.p.anchor, cur.p.atoms)
  const after = cur.item.after !== null ? readable(cur.item.after, cur.p.atoms) : null
  const diff = after !== null ? wordDiff(before, after) : []
  const counts = diffCounts(diff)
  const plural = (n: number) => (n === 1 ? 'one' : 'other')

  return (
    <div ref={rootRef} className="redo-review" tabIndex={0} onKeyDown={onKeyDown} role="group" aria-label={t('features.ai.redo.passage', { n: at + 1, total: rows.length })} data-testid="redo-review">
      <div className="redo-review__bar label">
        <button type="button" className="redo-review__nav" onClick={() => setAt((a) => Math.max(0, a - 1))} disabled={at === 0} aria-label={t('features.ai.redo.prev')}>
          <ChevronLeft size={13} strokeWidth={1.8} aria-hidden />
        </button>
        <span className="redo-review__pos" data-testid="redo-pos">
          {t('features.ai.redo.passage', { n: at + 1, total: rows.length })}
        </span>
        <button type="button" className="redo-review__nav" onClick={() => setAt((a) => Math.min(rows.length - 1, a + 1))} disabled={at >= rows.length - 1} aria-label={t('features.ai.redo.next')}>
          <ChevronRight size={13} strokeWidth={1.8} aria-hidden />
        </button>
        <span className="redo-review__state" data-state={state} data-testid="redo-state">
          {state === 'applied' || state === 'changed' ? t(`features.ai.redo.outcome.${state}`) : t(`features.ai.redo.state.${state}`)}
        </span>
        <span className="ai-out__spacer" />
        {after !== null && <span className="redo-review__delta">{t('features.ai.redo.delta', { del: counts.del, add: counts.add })}</span>}
      </div>
      <ol className="redo-review__dots" aria-hidden>
        {rows.map((r, i) => (
          <li key={r.p.n} data-state={r.item.outcome ?? (r.item.after === null ? 'skip' : (r.item.decision ?? 'open'))} data-current={i === at || undefined} onClick={() => setAt(i)} />
        ))}
      </ol>
      <div className="redo-review__body">
        {after === null ? (
          <>
            <p className="redo-review__note">{cur.p.skip ? t(`features.ai.redo.skip.${cur.p.skip}`) : t('features.ai.redo.skip.missing')}</p>
            {cur.p.anchor.trim() && <p className="redo-review__text redo-review__text--quiet">{before}</p>}
          </>
        ) : !counts.del && !counts.add ? (
          <>
            <p className="redo-review__note">{t('features.ai.redo.unchanged')}</p>
            <p className="redo-review__text">{after}</p>
          </>
        ) : (
          <p className="redo-review__text" data-testid="redo-diff">
            {diff.map((r, i) =>
              r.op === 'same' ? (
                <span key={i}>{r.text}</span>
              ) : r.op === 'del' ? (
                <del key={i} title={t('features.ai.redo.before')}>
                  {r.text}
                </del>
              ) : (
                <ins key={i} title={t('features.ai.redo.after')}>
                  {r.text}
                </ins>
              ),
            )}
          </p>
        )}
      </div>
      <div className="redo-review__keys">
        {applied ? (
          <button type="button" className="btn btn--primary btn--sm" onClick={() => (removeRun(run.id), onDone())}>
            {t('features.ai.redo.done')} <Kbd>↵</Kbd>
          </button>
        ) : allDecided ? (
          <>
            <span className="redo-review__sum label">{t('features.ai.redo.summary', { accept: accepted.length, reject: rejected })}</span>
            <button type="button" className="btn btn--primary btn--sm" onClick={() => void apply()} disabled={busy} data-testid="redo-apply">
              {accepted.length ? t(`features.ai.redo.apply.${plural(accepted.length)}`, { count: accepted.length }) : t('features.ai.redo.done')} <Kbd>↵</Kbd>
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn btn--sm" onClick={() => decide('accept')} disabled={after === null}>
              <Check size={13} strokeWidth={2} aria-hidden /> {t('features.ai.redo.accept')} <Kbd>y</Kbd>
            </button>
            <button type="button" className="btn btn--sm" onClick={() => decide('reject')} disabled={after === null}>
              <X size={13} strokeWidth={2} aria-hidden /> {t('features.ai.redo.reject')} <Kbd>n</Kbd>
            </button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => decideAllRedo(run.id, 'accept')}>
              {t('features.ai.redo.acceptAll')} <Kbd>a</Kbd>
            </button>
          </>
        )}
      </div>
      {!applied && accepted.length === 0 && allDecided && decidable.length > 0 && <p className="redo-review__note redo-review__note--foot">{t('features.ai.redo.nothing')}</p>}
    </div>
  )
}
