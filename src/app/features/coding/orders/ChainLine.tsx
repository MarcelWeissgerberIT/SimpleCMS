/**
 * Work orders on a pipeline task (spec §1.8 / §3.4):
 *  - `ChainLine`: the task panel's line "Teil von Prüfauftrag PA-12 · Schritt 2 von 3 · nächster Schritt: 03 QA" (its key
 *    opens the request) — from this device's record of the chain, never the Prüfauftrag / Schritt fields;
 *  - `NextStepFold`: on a gate card whose approval ends a chain step (TaskActionPlan.chain — the task panel's gate keys,
 *    Preflight's gate card): "Freigeben startet den nächsten Schritt: 03 · QA ‹Titel›" and a fold with that step as it
 *    will run — its page as this device's version view hashes it, the Grundlage it gets. Shown whole (opened and read to
 *    its end) it counts: the approval then passes the analysis checkpoint (`sawNext`) — nobody presses twice.
 */
import { useEffect, useMemo, useState } from 'react'
import { ArrowRight } from 'lucide-react'
import type { ID } from '../../../store/types'
import { useT } from '../../../i18n'
import { navigate } from '../../../lib/router'
import { ReadOnlyDoc } from '../../../editor'
import { claudeDoc } from '../../ai/claudeDoc'
import { taskVersionView, type TaskVersionView } from '../terminal'
import type { PipelineKind } from '../stages'
import { orderCode } from './db'
import { chainStepOf, useOrderRecord, useOrderRecords } from './records'
import { basisPreview } from './chainRun'
import { stepNo } from './words'
import { Edge, SeenFold, useSeenBook } from './seen'

const O = 'features.coding.order'

/** The task panel's chain line (nothing for a task that is no step of a chain on this device). */
export function ChainLine({ taskId }: { taskId: ID }) {
  const t = useT()
  // re-read when this device's records change (another tab, the engine)
  useOrderRecords((s) => s.recs)
  const at = chainStepOf(taskId)
  const stored = useOrderRecord(at?.row ?? null)
  const rec = stored && stored !== 'unreadable' ? stored : null
  if (!at || !rec?.chain) return null
  const steps = [...rec.chain.steps].sort((a, b) => a.n - b.n)
  const i = steps.findIndex((s) => s.id === taskId)
  if (i < 0) return null
  const next = steps[i + 1]
  const id = orderCode(at.row) ?? '—'
  return (
    <p className="ctk-chain" data-testid="coding-chain-line">
      <span className="label">
        {next
          ? t(`${O}.chain.part`, { id, n: i + 1, total: steps.length, next: `${stepNo(next.n)} ${t(`features.coding.pipe.${next.kind}`)}` })
          : t(`${O}.chain.partLast`, { id, n: i + 1, total: steps.length })}
      </span>
      <button type="button" className="ctk-link" onClick={() => navigate({ name: 'page', id: at.row })} data-testid="coding-chain-open">
        {t(`${O}.chain.open`)}
        <ArrowRight size={12} strokeWidth={1.75} aria-hidden />
      </button>
    </p>
  )
}

export interface ChainNext {
  row: ID
  step: number
  taskId: ID
  title: string
  kind: PipelineKind
}

/**
 * "Freigeben startet den nächsten Schritt …" with the step in a fold (see the head of this file). `onSeen(true)` once the
 * fold was opened and read to its end; `checkpoint`: the analysis checkpoint follows this approval (the note says what
 * seeing it does).
 */
export function NextStepFold({ next, from, onSeen, testId = 'order-gate-next' }: { next: ChainNext; from: ID; onSeen: (seen: boolean) => void; testId?: string }) {
  const t = useT()
  const stored = useOrderRecord(next.row)
  const rec = stored && stored !== 'unreadable' ? stored : null
  const chain = rec?.chain
  const fromStep = chain?.steps.find((s) => s.id === from)
  const checkpoint = !!chain?.checkpoint && fromStep?.kind === 'spec'
  const [view, setView] = useState<TaskVersionView | null>(null)
  useEffect(() => {
    let live = true
    void taskVersionView(next.taskId).then((v) => live && setView(v))
    return () => {
      live = false
    }
  }, [next.taskId])
  const doc = useMemo(() => (view?.markdown ? claudeDoc(view.markdown) : null), [view])
  const basis = useMemo(() => (chain ? basisPreview(chain, next.step) : null), [chain, next.step])
  const book = useSeenBook(`${next.taskId}:${view?.hash ?? ''}`)
  const key = `next:${next.taskId}:${view?.hash ?? ''}`
  const seen = book.has(`fold:${key}`) && book.has(`${key}:bottom`)
  useEffect(() => onSeen(seen), [seen]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="ctk-next" data-testid={testId} data-seen={seen ? '' : undefined}>
      <p className="ctk-next__line">{t(`${O}.gate.next`, { n: stepNo(next.step), kind: t(`features.coding.pipe.${next.kind}`), title: next.title })}</p>
      <SeenFold id={key} book={book} className="orc-fold ctk-next__fold" testId={`${testId}-fold`} summary={<summary className="orc-fold__sum label">{t(`${O}.gate.fold`, { n: stepNo(next.step) })}</summary>}>
        <div className="orc-fold__body">
          {doc ? <ReadOnlyDoc content={doc} className="orc-doc" headingOffset={2} /> : <p className="orc-line orc-line--quiet">{t(`${O}.key.readying`)}</p>}
          {basis && (
            <div className="ctk-next__basis">
              <p className="label">{t(`${O}.card.basis`)}</p>
              <ReadOnlyDoc content={{ type: 'doc', content: [basis] }} className="orc-doc" headingOffset={2} />
            </div>
          )}
          {view && <Edge id={key} edge="bottom" book={book} />}
        </div>
      </SeenFold>
      {checkpoint && <p className="orc-line orc-line--quiet">{t(seen ? `${O}.gate.seen` : `${O}.gate.unseen`)}</p>}
    </div>
  )
}
