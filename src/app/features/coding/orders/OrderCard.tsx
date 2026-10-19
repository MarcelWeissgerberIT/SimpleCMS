/**
 * Work orders in Preflight — the bodies of the cards (B9; lazy, Preflight's source names it as its `Body`). Each shows
 * what its key acts on IN FULL before the key can act (spec §2.10 "shown before it starts"):
 *  - 'ready': the plan as the plate shows it — the counter, "Verstanden:", the server's context, every station whole
 *    (the plate's own Station, read only: why, goal, criteria, the pages that go along in folds with their tags), the
 *    request, the open points, the cost line and the chain's budget; ↵ Kette starten waits until each was seen in full
 *    (the reason under the stations says what is missing — the same book as the plate);
 *  - 'next': why the chain waits (one line per reason), the step as it will run (for a Confirm wait exactly the version
 *    ↵ confirms), the Grundlage it takes along, every page that changed — what ↵ Weiter passes is what is drawn here;
 *  - 'halted': the halt, the spend against the chain's budget, what ↵ Fortsetzen starts (that step and its Grundlage),
 *    the step 1 may skip;
 *  - 'chainConfirm': every step the request's tasks hold — its version in full and where it stops under this device's
 *    Approvals; ↵ confirms exactly these versions, all or nothing;
 *  - 'interrupted': which steps were made, which not; 'request': the request as the planner would read it.
 * Text from Claude, a server or a page is shown read-only (claudeDoc: web images become links), never loaded.
 */
import { useMemo, type ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useWorkspace } from '../../../store/store'
import type { ID } from '../../../store/types'
import { useLang, useT } from '../../../i18n'
import type { Lang } from '@/shared/i18n'
import { fmtUsd } from '../../../lib/money'
import { ReadOnlyDoc } from '../../../editor'
import { claudeDoc } from '../../ai/claudeDoc'
import { costText } from '../../ai/Receipt'
import type { TaskVersionView } from '../terminal'
import { cardWhyLines } from './ChainCard'
import { ContextBox, SkipLine } from './Context'
import { Station, Tag, noteText, provForeign, useStations } from './ReadyPart'
import { projectAvgCost, COST_SAMPLE } from './costs'
import { olderParked } from './confirm'
import { nextBlock, nextKeysOf, nextScope, orderPrep, readyBlock, type OrderPrep, type StepShown } from './cardPrep'
import { useOrderRecord } from './records'
import { Edge, keyOf, useSeenBook, type SeenBook } from './seen'
import { preWhyText } from './text'
import { stepNo } from './words'
import { orderCode } from './db'
import { quoteTitleOf, requestNow } from './fingerprint'
import { autoFallbackText } from './autoWords'
import type { OrderDraft, OrderRecord } from './types'

type Tr = ReturnType<typeof useT>
const O = 'features.coding.order'
const P = 'features.coding.order.pf'

function Gone() {
  const t = useT()
  return <p className="pf-card__gone">{t('features.preflight.card.gone')}</p>
}

function Waiting() {
  const t = useT()
  return <p className="pf-card__wait">{t('features.preflight.card.preparing')}</p>
}

/** A document read only, at the UI's reading size (the plate's own class). */
function Doc({ markdown, testId }: { markdown: string; testId?: string }) {
  const doc = useMemo(() => claudeDoc(markdown || '—'), [markdown])
  return (
    <div className="orc-doc-wrap" data-testid={testId}>
      <ReadOnlyDoc content={doc} className="orc-doc" headingOffset={2} />
    </div>
  )
}

/**
 * One step as it will run: its head line, its page as the version view shows it, the Grundlage it takes. With `seen`
 * (the 'next' card): each between top / bottom edges in that book — ↵ Weiter waits until both were read to their end.
 */
function StepAsItRuns({ shown, lead, t, seen }: { shown: StepShown; lead: string; t: Tr; seen?: { book: SeenBook; step: string; basis: string | null } }) {
  const title = shown.view?.title.trim() || shown.step.title || t('common.untitled')
  return (
    <div className="ord-step" data-testid="pf-order-step" data-step={shown.step.n}>
      <p className="label ord-step__head">{lead || t(`${O}.plan.next`, { n: stepNo(shown.step.n), kind: t(`${O}.kind.${shown.step.kind}`), title })}</p>
      <p className="label ord-sub">{t(`${O}.card.text`)}</p>
      {seen && shown.view && <Edge id={seen.step} edge="top" book={seen.book} />}
      {shown.view ? <Doc markdown={shown.view.markdown} testId="pf-order-step-text" /> : <Gone />}
      {seen && shown.view && <Edge id={seen.step} edge="bottom" book={seen.book} />}
      {shown.basis && (
        <div className="ord-basis" data-testid="pf-order-basis">
          <p className="label ord-sub">{t(`${O}.card.basis`)}</p>
          {seen?.basis && <Edge id={seen.basis} edge="top" book={seen.book} />}
          <ReadOnlyDoc content={{ type: 'doc', content: [shown.basis] }} className="orc-doc" headingOffset={2} />
          {seen?.basis && <Edge id={seen.basis} edge="bottom" book={seen.book} />}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ ready */

function ReadyBody({ id, row }: { id: string; row: ID }) {
  const t = useT()
  const lang = useLang()
  const stored = useOrderRecord(row)
  const rec = stored && stored !== 'unreadable' ? stored : null
  const draft = rec?.state === 'draft' ? rec.draft : undefined
  if (!rec || !draft?.plan.steps.length) return <Gone />
  return <ReadyStations id={id} row={row} rec={rec} draft={draft} t={t} lang={lang} />
}

function ReadyStations({ id, row, rec, draft, t, lang }: { id: string; row: ID; rec: OrderRecord; draft: OrderDraft; t: Tr; lang: Lang }) {
  const { stations, projects, base, config } = useStations(row, rec, draft)
  const book = useSeenBook(`${row}:${draft.run}`)
  const server = draft.source.server
  const ctxKey = draft.plan.context ? keyOf(JSON.stringify(draft.plan.context)) : null
  const cost = draft.receipt ? costText(t, lang, draft.receipt.usd, draft.receipt.costSource) : null
  const counter = [t(`${O}.plan.steps.${draft.plan.steps.length === 1 ? 'one' : 'other'}`, { n: draft.plan.steps.length }), stations.holds === 0 ? t(`${O}.ready.holds.none`) : t(`${O}.ready.holds.${stations.holds === 1 ? 'one' : 'other'}`, { n: stations.holds }), ...(cost ? [cost] : [])].join(' · ')
  const costs = [...new Set(draft.plan.steps.map((s) => s.kind))].flatMap((kind) => {
    const avg = projectAvgCost(projects.find((p) => p.kind === kind)?.project ?? null)
    return avg ? [t(`${O}.plan.cost.kind`, { usd: fmtUsd(avg.avg, lang), kind: t(`features.coding.pipe.${kind}`) })] : []
  })
  const budget = draft.budget !== undefined ? draft.budget : (config?.budgetUsd ?? null)
  const older = olderParked(rec)
  const noRepo = stations.list.filter((s) => s.step.kind === 'coding' && !s.step.repo)
  // why ↵ cannot act yet — read again whenever something was seen (the book's version re-renders this)
  const why = readyBlock(id)
  return (
    <div className="orc-ready ord-ready" data-testid="pf-order-ready">
      <p className="label orc-counter">{counter}</p>
      {!!draft.auto?.reasons.length && <p className="orc-line orc-line--warn">{autoFallbackText(draft.auto.reasons, t, { row, titleOf: quoteTitleOf })}</p>}
      {draft.plan.summary && (
        <p className="orc-understood">
          <span className="label">{t(`${O}.plan.understood`)}</span> {draft.plan.summary}
        </p>
      )}
      {(draft.notes ?? []).length > 0 && (
        <ul className="orc-notes">
          {(draft.notes ?? []).map((n, i) => (
            <li key={i} className="orc-line orc-line--quiet">
              {noteText(n, t)}
            </li>
          ))}
        </ul>
      )}
      {server && draft.plan.context && ctxKey ? (
        <ContextBox draft={draft} goesWith={stepNo(base + 1)} edges={<Edge id={`ctx:${ctxKey}`} edge="top" book={book} />} end={<Edge id={`ctx:${ctxKey}`} edge="bottom" book={book} />} />
      ) : (
        <SkipLine draft={draft} />
      )}
      <ol className="orc-stations" data-testid="pf-order-stations">
        {stations.list.map((f, i) => (
          <Station key={`${i}:${f.key}`} facts={f} index={i} draft={draft} book={book} viewer repos={[]} onEdit={() => {}} onRepo={() => {}} editing={null} />
        ))}
      </ol>
      <RequestText row={row} foreign={provForeign(draft.source.prov[row])} t={t} />
      {older.length > 0 && <p className="orc-line">{t(`${O}.plan.older`, { list: older.length > 1 ? `${stepNo(older[0]!.n)}–${stepNo(older[older.length - 1]!.n)}` : stepNo(older[0]!.n) })}</p>}
      {(draft.plan.questions.length > 0 || noRepo.length > 0) && (
        <div className="orc-open">
          <p className="label">{t(`${O}.plan.open`)}</p>
          <ul>
            {noRepo.map((s) => (
              <li key={s.n}>{t(`${O}.plan.openRepo`, { n: stepNo(s.n) })}</li>
            ))}
            {draft.plan.questions.map((q, i) => (
              <li key={`q${i}`}>{q}</li>
            ))}
          </ul>
        </div>
      )}
      <p className="orc-line orc-cost">{costs.length ? `${t(`${O}.plan.cost.head`)} ${costs.join(' · ')} ${t(`${O}.plan.cost.last`, { n: COST_SAMPLE })} · ${t(`${O}.plan.cost.notCapped`)}` : t(`${O}.plan.costNone`)}</p>
      <p className="orc-line" data-testid="pf-order-budget">
        {budget === null ? t(`${P}.budget.none`) : t(`${P}.budget.set`, { usd: fmtUsd(budget, lang) })}
      </p>
      {why && (
        <p className="orc-line orc-line--quiet" role="status" data-testid="pf-order-why">
          {why.key.startsWith('features.') ? t(why.key, why.vars) : why.key}
        </p>
      )}
    </div>
  )
}

function RequestText({ row, foreign, t }: { row: ID; foreign: boolean; t: Tr }) {
  // the request as every step quotes it (this tab's context marks respected) — read again when the row changes
  const page = useWorkspace((s) => s.pages[row])
  const text = useMemo(() => (page ? requestNow(row).text : ''), [row, page])
  return (
    <div className="ord-request" data-testid="pf-order-request">
      <p className="label">
        {t(`${O}.request.title`)} {foreign && <Tag kind="foreign" />}
      </p>
      <p className="orc-request__text">{text.trim() || '—'}</p>
    </div>
  )
}

/* ------------------------------------------------------------------ next */

function NextBody({ id, prep }: { id: string; prep: Extract<OrderPrep, { kind: 'next' }> }) {
  const t = useT()
  const refPages = useWorkspace(useShallow((s) => (prep.move.refs ?? []).map((id) => s.pages[id])))
  const step = prep.next.step
  const title = prep.next.view?.title.trim() || step.title || t('common.untitled')
  const lines = cardWhyLines(prep.move, { kind: t(`${O}.kind.${step.kind}`), title, refs: refPages }, t)
  // Fix 3: the plate's seen book for this step — ↵ Weiter waits until each part was read to its end (here or there)
  const book = useSeenBook(nextScope(prep.row, prep.chain.run, prep.move.step))
  const keys = nextKeysOf(prep)
  const refKey = new Map(keys.refs)
  const why = nextBlock(id)
  return (
    <div className="ord-card" data-testid="pf-order-next" data-all={prep.move.all.join(' ')}>
      {lines.map((line, i) => (
        <p key={i} className="orc-line orc-line--warn" data-testid="pf-order-why-line">
          {line}
        </p>
      ))}
      <StepAsItRuns shown={prep.next} lead="" t={t} seen={{ book, step: keys.step, basis: keys.basis }} />
      {prep.refs.map((r) => (
        <div key={r.id} className="ord-ref" data-testid="pf-order-ref">
          <p className="label ord-sub">{t(`${O}.card.ref`, { title: r.title || t('common.untitled') })}</p>
          <Edge id={refKey.get(r.id)!} edge="top" book={book} />
          <pre className="orc-card__text">{r.text || '—'}</pre>
          <Edge id={refKey.get(r.id)!} edge="bottom" book={book} />
        </div>
      ))}
      {why && (
        <p className="orc-line orc-line--quiet" role="status" data-testid="pf-order-why">
          {why.key.startsWith('features.') ? t(why.key, why.vars) : why.key}
        </p>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ halted */

function HaltedBody({ prep }: { prep: Extract<OrderPrep, { kind: 'halted' }> }) {
  const t = useT()
  const lang = useLang()
  const halt = prep.chain.halted
  const why = halt ? t(`${O}.halt.${halt.why}`, { n: halt.step !== undefined ? stepNo(halt.step) : '' }) : t(`${O}.halt.status`)
  const budget = prep.chain.budgetUsd
  return (
    <div className="ord-card" data-testid="pf-order-halted">
      <p className="orc-line orc-line--warn">{t(`${O}.chain.halted`, { why })}</p>
      {budget !== undefined && (
        <p className="orc-line" data-testid="pf-order-spent">
          {t(`${P}.spent`, { spent: fmtUsd(prep.spent, lang), budget: fmtUsd(budget, lang) })}
        </p>
      )}
      {prep.resumes ? (
        <StepAsItRuns
          shown={prep.resumes}
          lead={t(`${P}.resumes`, { n: stepNo(prep.resumes.step.n), kind: t(`${O}.kind.${prep.resumes.step.kind}`), title: prep.resumes.view?.title.trim() || prep.resumes.step.title || t('common.untitled') })}
          t={t}
        />
      ) : (
        <p className="orc-line orc-line--quiet">{t(`${P}.resumesNothing`)}</p>
      )}
      {prep.skippable.length > 0 && <p className="orc-line orc-line--quiet">{t(`${O}.skip.note`)}</p>}
    </div>
  )
}

/* ------------------------------------------------------------------ chainConfirm */

function stageText(s: TaskVersionView['stages'][number], t: Tr): string {
  const parts = [s.name, t(`features.coding.kind.${s.kind}`)]
  if (s.auto) parts.push(t('features.coding.pipeline.autoShort'))
  if (s.model) parts.push(s.model)
  return parts.join(' · ')
}

function ConfirmBody({ prep }: { prep: Extract<OrderPrep, { kind: 'chainConfirm' }> }) {
  const t = useT()
  return (
    <div className="ord-card" data-testid="pf-order-confirm">
      <p className="orc-line">{t(`${P}.confirm.lead`)}</p>
      {prep.problem && <p className="orc-line orc-line--warn">{t(`${P}.confirm.${prep.problem}`)}</p>}
      <ol className="ord-steps">
        {prep.steps.map(({ carrier, view, stops }) => (
          <li key={carrier.id} className="ord-step" data-testid="pf-order-step">
            <p className="label ord-step__head">
              {carrier.n !== null ? stepNo(carrier.n) : '—'} · {t(`${O}.kind.${carrier.kind}`)} · {view?.title.trim() || t('common.untitled')}
            </p>
            <p className="orc-step__meta label">
              {[view?.fields.repo ?? t(`${O}.plan.noRepo`), view?.fields.branch, view?.fields.stage ?? '—'].filter(Boolean).join(' · ')} · {stops.length ? t(`${O}.plan.stops`, { gates: stops.join(', ') }) : t(`${O}.plan.stopsNone`)}
            </p>
            {view ? <Doc markdown={view.markdown} testId="pf-order-step-text" /> : <Gone />}
            {(view?.refs ?? []).map((r) => (
              <div key={r.id} className="ord-ref">
                <p className="label ord-sub">{t(`${O}.card.ref`, { title: r.title || t('common.untitled') })}</p>
                <pre className="orc-card__text">{r.markdown || '—'}</pre>
              </div>
            ))}
            {view && (
              <ol className="ord-stages" aria-label={t(`${P}.confirm.stages`)}>
                {view.stages.map((s, i) => (
                  <li key={i}>
                    <span className="label">{stageText(s, t)}</span>
                    {s.instructions && <pre className="orc-card__text">{s.instructions}</pre>}
                  </li>
                ))}
              </ol>
            )}
          </li>
        ))}
      </ol>
    </div>
  )
}

/* ------------------------------------------------------------------ interrupted, request */

function InterruptedBody({ prep }: { prep: Extract<OrderPrep, { kind: 'interrupted' }> }) {
  const t = useT()
  const pages = useWorkspace(useShallow((s) => prep.chain.steps.map((st) => s.pages[st.id])))
  const made = new Set(prep.made)
  return (
    <div className="ord-card" data-testid="pf-order-interrupted">
      <p className="orc-line orc-line--warn">{t(`${O}.chain.interrupted`, { made: prep.made.length, total: prep.chain.steps.length })}</p>
      <ul className="ord-list">
        {[...prep.chain.steps]
          .sort((a, b) => a.n - b.n)
          .map((st) => (
            <li key={st.id}>
              <span className="label">{stepNo(st.n)}</span> {pages[prep.chain.steps.indexOf(st)]?.title.trim() || st.title || t('common.untitled')} · <span className="label">{t(made.has(st.id) ? `${P}.made` : `${P}.notMade`)}</span>
            </li>
          ))}
      </ul>
      {!prep.pre.ok && <p className="orc-line orc-line--quiet">{preWhyText(prep.pre.why, prep.pre.left)}</p>}
    </div>
  )
}

function RequestBody({ prep }: { prep: Extract<OrderPrep, { kind: 'request' }> }) {
  const t = useT()
  return (
    <div className="ord-card" data-testid="pf-order-request-card">
      <p className="orc-line">{t(`${P}.request.lead`, { id: orderCode(prep.row) ?? '—' })}</p>
      <div className="ord-request">
        <p className="label">{t(`${O}.request.title`)}</p>
        <p className="orc-request__text">{prep.text.trim() || '—'}</p>
      </div>
      {!prep.pre.ok && <p className="orc-line orc-line--quiet">{preWhyText(prep.pre.why, prep.pre.left)}</p>}
    </div>
  )
}

/* ------------------------------------------------------------------ the body */

/** Preflight's body of an orders card: `item.id` names it (lamp.ts); its data was read when it became current. */
export default function OrderCardBody({ item }: { item: { id: string }; expanded: boolean }): ReactNode {
  const prep = orderPrep(item.id)
  if (!prep) return <Waiting />
  switch (prep.kind) {
    case 'stale':
      return <Gone />
    case 'ready':
      return <ReadyBody id={item.id} row={prep.row} />
    case 'next':
      return <NextBody id={item.id} prep={prep} />
    case 'halted':
      return <HaltedBody prep={prep} />
    case 'chainConfirm':
      return <ConfirmBody prep={prep} />
    case 'interrupted':
      return <InterruptedBody prep={prep} />
    case 'request':
      return <RequestBody prep={prep} />
  }
}
