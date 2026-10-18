/**
 * The plate in "Kette bereit" (spec §1.5, B8): what ↵ Kette starten confirms, every word of it on screen first.
 *  - the head counter "3 Schritte · hält 4× für dich · ≈ 0,03 $"; "Verstanden: …" (the planner's summary) and what
 *    reading its answer changed;
 *  - when a server took part: the cut-out "Kontext · Zusammenfassung des Planers" tagged FREMD ("geht in Schritt 01 mit"),
 *    above the full call list and the tools it could / could not call; when the picked server stayed out: why
 *    ("ohne Server: …", an untested one offers "Server testen");
 *  - the request itself ("Auftrag"): beside the plan when the plate is wide, else behind "Auftrag zeigen";
 *  - one station per step: a sticky head (number · kind · title · FREMD) over its meta (project · repo · model ·
 *    "stoppt bei: …"), then why, the goal and the criteria in full (never clipped), the pages that go along (a class tag
 *    PRIVAT / MAIL / FREMD each, the text in a fold), the branch, the next step. A station counts as seen once rendered
 *    whole (both edges on screen) and its page folds opened (seen.tsx) — ↵ waits for every one;
 *  - "Offen:" (the planner's open points; a coding step without a repo picks one in its station), the cost line
 *    ("Claude Code: bisher Ø … · der Regler begrenzt das nicht"), "Budget je Kette" for this chain, the older parked steps
 *    that go to the trash;
 *  - the keys: ⚙ the work orders' settings · D Verwerfen (Status → Entwurf; Z in the toast) · R Neu planen (asks after
 *    edits) · O Ohne Server neu planen (a server took part) · E Schritt bearbeiten · Entf Schritt entfernen (Z) · Alt+↑/↓
 *    verschieben · ↵ Kette starten — VON HAND: a fresh press ≥ 300 ms after it became ready, `aria-disabled` with its
 *    reason (said beside it), a plate-wide ↵ only focuses it. Keys act only with focus in the plate, never while typing,
 *    never on a repeat, no modifier but ⇧ (Alt only for the moves). On a phone the keys row is the bottom bar.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronUp, Pencil, Settings2, Trash2 } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useWorkspace } from '../../../store/store'
import type { ID } from '../../../store/types'
import type { Writer } from '../../../store/writer'
import { ReadOnlyDoc } from '../../../editor'
import { CodeArea, markdownTokenizer } from '../../../ui/code'
import { typingWithin } from '../../../ui/keys'
import { useLang, useT } from '../../../i18n'
import { useUI } from '../../../store/ui'
import { fmtUsd, fmtAmount, parseAmount } from '../../../lib/money'
import { classOfPage } from '../../ai/core'
import { claudeDoc } from '../../ai/claudeDoc'
import { costText } from '../../ai/Receipt'
import { provOutside } from './autoCore'
import { useCoding, defaultApprovals } from '../state'
import { modelLabel } from '../tasks'
import { stepNo } from './words'
import { HandKey } from './HandKey'
import { kindProjects, type KindProject } from './facts'
import { readOrderConfig } from './config'
import { olderParked, planHashNow, startChain } from './confirm'
import { editStep, moveStep, removeStep, restoreDraft, setDraftBudget, type EditOutcome, type StepPatch } from './edit'
import { endsAtGate, holdsOf, checkpointAfter, stopsOf, type StopStep } from './stops'
import { projectAvgCost, COST_SAMPLE } from './costs'
import { pageShown, quoteTitleOf, requestNow } from './fingerprint'
import { autoFallbackText } from './autoWords'
import { writeOrderStatus } from './db'
import { preWhyText } from './text'
import { refusalText } from './ChainPart'
import { Edge, keyOf, SeenFold, useSeenBook, type SeenBook } from './seen'
import { QuestionsForm } from './Questions'
import { ContextBox, SkipLine } from './Context'
import { OrderSettingsKey } from './OrderSettings'
import type { OrderPreResult } from './pre'
import { PLAN_LIMITS, type OrderDraft, type OrderKind, type OrderProv, type OrderRecord, type OrderStepPlan } from './types'

type Tr = ReturnType<typeof useT>
const O = 'features.coding.order'
const YOU: Writer = { kind: 'you', via: 'ui' }
/** stages that run Claude Code (their model shows on the station) */
const CLAUDE_STAGES = new Set(['plan', 'implement', 'doc'])
/**
 * Who last wrote a page the planner read, as a class: someone other than the person (an agent, the sync, Claude, the
 * bridge on a request's title / fields …) — the auto mode's own rule (autoCore.ts provOutside, Fix 2).
 */
export const provForeign = (p: OrderProv | undefined): boolean => provOutside(p)

/** The class tags of a page that goes along: PRIVAT · MAIL · FREMD. */
function tagsOf(id: ID, prov: OrderProv | undefined): Array<'private' | 'mail' | 'foreign'> {
  const s = useWorkspace.getState()
  const classes = classOfPage(id, { pages: s.pages, databases: s.databases, mailDb: s.settings.mail?.databaseId ?? null })
  return [...(classes.has('private') ? (['private'] as const) : []), ...(classes.has('mail') ? (['mail'] as const) : []), ...(provForeign(prov) ? (['foreign'] as const) : [])]
}

export function Tag({ kind }: { kind: 'private' | 'mail' | 'foreign' }) {
  const t = useT()
  return (
    <span className="label orc-tag" data-tag={kind} data-testid={`order-tag-${kind}`}>
      {t(kind === 'foreign' ? `${O}.plan.foreign` : `${O}.tag.${kind}`)}
    </span>
  )
}

/* ------------------------------------------------------------------ one station */

interface StationFacts {
  n: number
  step: OrderStepPlan
  kp: KindProject | undefined
  stops: string[]
  checkpoint: boolean
  next: { n: number; step: OrderStepPlan } | null
  /** a QA step that takes the branch of this coding step (its number) */
  sharedFrom: number | null
  model: string | null
  /** what the station shows, as a key (an edit makes it a new station: seen again) */
  key: string
}

function StepEditor({ facts, repos, kinds, onSave, onCancel }: { facts: StationFacts; repos: string[]; kinds: OrderKind[]; onSave: (p: StepPatch) => Promise<string | null>; onCancel: () => void }) {
  const t = useT()
  const { step } = facts
  const [title, setTitle] = useState(step.title)
  const [goal, setGoal] = useState(step.goal)
  const [criteria, setCriteria] = useState(step.criteria.join('\n'))
  const [kind, setKind] = useState<OrderKind>(step.kind)
  const [repo, setRepo] = useState(step.repo ?? '')
  const [branch, setBranch] = useState(step.branch ?? '')
  const [priority, setPriority] = useState(step.priority)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const tokenize = useMemo(() => markdownTokenizer({}), [])
  const first = useRef<HTMLInputElement>(null)
  useEffect(() => first.current?.focus(), [])
  const id = `orc-edit-${facts.n}`
  const save = async () => {
    if (busy) return
    setBusy(true)
    const why = await onSave({ title, goal, criteria: criteria.split('\n'), kind, repo: repo || null, branch: kind === 'coding' ? branch : null, priority })
    setBusy(false)
    setError(why)
  }
  return (
    <form
      className="orc-edit"
      aria-label={t(`${O}.edit.label`, { n: stepNo(facts.n) })}
      data-testid="order-step-edit"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          onCancel()
        } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault()
          void save()
        }
      }}
    >
      <label className="orc-edit__field">
        <span className="label">{t(`${O}.edit.title`)}</span>
        <input ref={first} className="input" value={title} maxLength={PLAN_LIMITS.title} onChange={(e) => setTitle(e.target.value)} data-testid="order-edit-title" />
      </label>
      <div className="orc-edit__row">
        <label className="orc-edit__field">
          <span className="label">{t(`${O}.edit.kind`)}</span>
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value as OrderKind)} data-testid="order-edit-kind">
            {kinds.map((k) => (
              <option key={k} value={k}>
                {t(`features.coding.pipe.${k}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="orc-edit__field">
          <span className="label">{t(`${O}.edit.repo`)}</span>
          <select className="input" value={repo} onChange={(e) => setRepo(e.target.value)} data-testid="order-edit-repo">
            <option value="">{t(`${O}.plan.noRepo`)}</option>
            {repos.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        {kind === 'coding' && (
          <label className="orc-edit__field">
            <span className="label">{t(`${O}.edit.branch`)}</span>
            <input className="input" value={branch} placeholder={t(`${O}.edit.branchNew`)} maxLength={200} onChange={(e) => setBranch(e.target.value)} data-testid="order-edit-branch" />
          </label>
        )}
        <label className="orc-edit__field">
          <span className="label">{t(`${O}.edit.priority`)}</span>
          <select className="input" value={priority} onChange={(e) => setPriority(e.target.value as OrderStepPlan['priority'])}>
            {(['high', 'medium', 'low'] as const).map((p) => (
              <option key={p} value={p}>
                {t(`features.coding.priority.${p}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="orc-edit__field">
        <label className="label" htmlFor={`${id}-goal`}>
          {t(`${O}.edit.goal`)}
        </label>
        <CodeArea id={`${id}-goal`} value={goal} onChange={(v) => setGoal(v)} tokenize={tokenize} wrap lineNumbers={false} minRows={4} maxRows={14} enter="list" maxLength={PLAN_LIMITS.goal} storageKey="order.goal" testId="order-edit-goal" />
      </div>
      <div className="orc-edit__field">
        <label className="label" htmlFor={`${id}-criteria`}>
          {t(`${O}.edit.criteria`)}
        </label>
        <CodeArea id={`${id}-criteria`} value={criteria} onChange={(v) => setCriteria(v)} wrap lineNumbers={false} minRows={3} maxRows={10} enter="plain" storageKey="order.criteria" testId="order-edit-criteria" />
      </div>
      {error && (
        <p className="orc-line orc-line--warn" role="alert" data-testid="order-edit-error">
          {error}
        </p>
      )}
      <div className="orp-keys">
        <button type="button" className="btn btn--sm btn--ghost" onClick={onCancel}>
          {t('common.cancel')}
        </button>
        <button type="submit" className="btn btn--sm btn--primary" disabled={busy} data-testid="order-edit-save">
          {t(`${O}.edit.save`)}
        </button>
      </div>
    </form>
  )
}

export function Station({
  facts,
  index,
  draft,
  book,
  editing,
  viewer,
  repos,
  onEdit,
  onRepo,
  onRemove,
  onMove,
  count,
}: {
  facts: StationFacts
  index: number
  draft: OrderDraft
  book: SeenBook
  editing: ReactNode
  viewer: boolean
  repos: string[]
  onEdit: (i: number) => void
  onRepo: (i: number, repo: string) => void
  /** Fix 2: the station's own keys for what Entf / Alt+↑↓ do (a phone has neither) — absent: not offered here */
  onRemove?: (i: number) => void
  onMove?: (i: number, by: -1 | 1) => void
  /** how many stations the plan has (the first cannot move up, the last not down, the only one not go) */
  count?: number
}) {
  const t = useT()
  const { step, n, kp } = facts
  const key = facts.key
  const server = !!draft.source.server
  const goalDoc = useMemo(() => claudeDoc(step.goal), [step.goal])
  const pages = useWorkspace(useShallow((s) => step.refs.map((id) => s.pages[id])))
  const seen = book.whole(key) && step.refs.every((id) => book.has(`fold:${key}:${id}`))
  const stops = facts.stops.length || facts.checkpoint ? [...facts.stops, ...(facts.checkpoint ? [t(`${O}.plan.checkpoint`)] : [])].join(', ') : ''
  const kind = t(`features.coding.pipe.${step.kind}`)
  const branch =
    step.kind === 'coding' ? (step.branch ? t(`${O}.plan.branchNamed`, { branch: step.branch }) : t(`${O}.plan.branchNew`)) : facts.sharedFrom !== null ? t(`${O}.plan.branchFrom`, { n: stepNo(facts.sharedFrom) }) : null
  return (
    <li className="orc-station" data-station={index} data-seen={seen ? '' : undefined} data-testid="order-plan-step">
      <div className="orc-station__bar" tabIndex={0} aria-label={t(`${O}.station.aria`, { n: stepNo(n), kind, title: step.title })} data-testid="order-station-head">
        <span className="label orc-step__n">{stepNo(n)}</span>
        <span className="label">{kind}</span>
        <strong className="orc-step__title">{step.title}</strong>
        {server && <Tag kind="foreign" />}
        <span className="label orc-station__seen" data-on={seen ? '' : undefined} aria-hidden>
          {seen ? t(`${O}.station.seen`) : t(`${O}.station.unseen`)}
        </span>
      </div>
      <Edge id={key} edge="top" book={book} />
      <p className="orc-step__meta label">
        {kp ? t(kp.project ? `${O}.plan.project` : `${O}.plan.projectNew`, { name: kp.title }) : ''} · {step.repo ? t(`${O}.plan.repo`, { repo: step.repo }) : t(`${O}.plan.noRepo`)}
        {facts.model ? ` · ${t(`${O}.plan.model`, { model: modelLabel(facts.model) })}` : ''} · {stops ? t(`${O}.plan.stops`, { gates: stops }) : t(`${O}.plan.stopsNone`)}
      </p>
      {editing ?? (
        <>
          {step.why && <p className="orc-step__why">{step.why}</p>}
          <div className="orc-step__goal">
            <ReadOnlyDoc content={goalDoc} className="orc-doc" headingOffset={2} />
          </div>
          {step.criteria.length > 0 && (
            <ul className="orc-step__criteria" aria-label={t(`${O}.plan.criteria`)}>
              {step.criteria.map((c, k) => (
                <li key={k}>{c}</li>
              ))}
            </ul>
          )}
          {step.refs.length > 0 && (
            <div className="orc-refs">
              <p className="label orc-refs__head">{t(`${O}.plan.pages`)}</p>
              {step.refs.map((id, k) => {
                const page = pages[k]
                const title = !page ? t('common.untitled') : page.private ? t(`${O}.plan.privatePage`) : page.title.trim() || t('common.untitled')
                return (
                  <SeenFold
                    key={id}
                    id={`${key}:${id}`}
                    book={book}
                    testId="order-plan-ref"
                    summary={
                      <summary className="orc-fold__sum">
                        <span className="orc-fold__title">{title}</span>
                        {tagsOf(id, draft.source.prov[id]).map((g) => (
                          <Tag key={g} kind={g} />
                        ))}
                        <span className="label orc-fold__hint">{book.has(`fold:${key}:${id}`) ? t(`${O}.station.opened`) : t(`${O}.station.open`)}</span>
                      </summary>
                    }
                  >
                    <div className="orc-fold__body">{page ? <ReadOnlyDoc content={page.content ?? null} className="orc-doc" headingOffset={2} /> : <p>{pageShown(undefined).text || '—'}</p>}</div>
                  </SeenFold>
                )
              })}
            </div>
          )}
          {step.kind === 'coding' && !step.repo && !viewer && (
            <label className="orc-pick" data-testid="order-pick-repo">
              <span className="label">{t(`${O}.plan.pickRepo`)}</span>
              <select className="input" value="" onChange={(e) => e.target.value && onRepo(index, e.target.value)}>
                <option value="">{t(`${O}.plan.pickRepoNone`)}</option>
                {repos.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
          )}
          <p className="orc-step__foot label">
            {branch && <span>{branch}</span>}
            {facts.next && <span>{t(`${O}.plan.next`, { n: stepNo(facts.next.n), kind: t(`${O}.kind.${facts.next.step.kind}`), title: facts.next.step.title })}</span>}
            {!viewer && (
              <span className="orc-station__keys">
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => onEdit(index)} data-testid="order-step-edit-key">
                  <span className="kbd" aria-hidden>
                    E
                  </span>
                  <Pencil size={13} strokeWidth={1.75} aria-hidden />
                  {t(`${O}.key.edit`)}
                </button>
                {onMove && (count ?? 0) > 1 && index > 0 && (
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => onMove(index, -1)} data-testid="order-step-up" aria-label={t(`${O}.key.moveUpAria`, { n: stepNo(n) })}>
                    <span className="kbd" aria-hidden>
                      Alt+↑
                    </span>
                    <ChevronUp size={13} strokeWidth={1.75} aria-hidden />
                    {t(`${O}.key.moveUp`)}
                  </button>
                )}
                {onMove && (count ?? 0) > 1 && index < (count ?? 0) - 1 && (
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => onMove(index, 1)} data-testid="order-step-down" aria-label={t(`${O}.key.moveDownAria`, { n: stepNo(n) })}>
                    <span className="kbd" aria-hidden>
                      Alt+↓
                    </span>
                    <ChevronDown size={13} strokeWidth={1.75} aria-hidden />
                    {t(`${O}.key.moveDown`)}
                  </button>
                )}
                {onRemove && (count ?? 0) > 1 && (
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => onRemove(index)} data-testid="order-step-remove" aria-label={t(`${O}.key.removeAria`, { n: stepNo(n) })}>
                    <span className="kbd" aria-hidden>
                      {t(`${O}.kbd.delete`)}
                    </span>
                    <Trash2 size={13} strokeWidth={1.75} aria-hidden />
                    {t(`${O}.key.removeShort`)}
                  </button>
                )}
              </span>
            )}
          </p>
        </>
      )}
      <Edge id={key} edge="bottom" book={book} />
    </li>
  )
}

/* ------------------------------------------------------------------ budget field */

function BudgetField({ rowId, draft, configUsd, viewer }: { rowId: ID; draft: OrderDraft; configUsd: number | undefined; viewer: boolean }) {
  const t = useT()
  const lang = useLang()
  const current = draft.budget !== undefined ? draft.budget : (configUsd ?? null)
  const [text, setText] = useState(current === null ? '' : fmtAmount(current, lang))
  const [bad, setBad] = useState(false)
  useEffect(() => setText(current === null ? '' : fmtAmount(current, lang)), [current, lang])
  const commit = (value: string) => {
    const trimmed = value.trim()
    if (!trimmed) {
      setBad(false)
      if (current !== null) void setDraftBudget(rowId, null)
      return
    }
    const usd = parseAmount(trimmed, lang)
    if (usd === null || !(usd > 0)) return setBad(true)
    setBad(false)
    if (usd !== current) void setDraftBudget(rowId, usd)
  }
  const id = `orc-budget-${rowId}`
  return (
    <div className="orc-budget" data-testid="order-budget">
      <label className="label" htmlFor={id}>
        {t(`${O}.budget.label`)}
      </label>
      <span className="orc-budget__field">
        <input
          id={id}
          className="input orc-budget__input"
          inputMode="decimal"
          value={text}
          disabled={viewer}
          placeholder={t(`${O}.budget.none`)}
          aria-invalid={bad || undefined}
          aria-describedby={`${id}-note`}
          onChange={(e) => setText(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commit((e.target as HTMLInputElement).value)
            }
          }}
          data-testid="order-budget-input"
        />
        <span className="label" aria-hidden>
          $
        </span>
      </span>
      {!viewer && (
        <span className="orc-budget__quick">
          {[5, 10, 25].map((usd) => (
            <button key={usd} type="button" className="btn btn--ghost btn--sm" aria-pressed={current === usd} onClick={() => void setDraftBudget(rowId, usd)} data-testid={`order-budget-${usd}`}>
              {fmtUsd(usd, lang)}
            </button>
          ))}
        </span>
      )}
      <p className="orc-line orc-line--quiet" id={`${id}-note`}>
        {bad ? t(`${O}.budget.bad`) : t(`${O}.budget.note`)}
      </p>
    </div>
  )
}

/* ------------------------------------------------------------------ the request beside the plan */

function RequestPanel({ rowId, draft }: { rowId: ID; draft: OrderDraft }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const row = useWorkspace((s) => s.pages[rowId])
  const text = useMemo(() => (row ? requestNow(rowId).text : ''), [rowId, row])
  const foreign = provForeign(draft.source.prov[rowId])
  return (
    <aside className="orc-request" data-open={open ? '' : undefined} aria-label={t(`${O}.request.title`)} data-testid="order-request">
      <button type="button" className="btn btn--ghost btn--sm orc-request__toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)} data-testid="order-request-toggle">
        {open ? <ChevronUp size={13} strokeWidth={1.75} aria-hidden /> : <ChevronDown size={13} strokeWidth={1.75} aria-hidden />}
        {t(open ? `${O}.request.hide` : `${O}.request.show`)}
      </button>
      <div className="orc-request__body">
        <p className="label orc-request__head">
          {t(`${O}.request.title`)}
          {foreign && <Tag kind="foreign" />}
        </p>
        <p className="orc-request__text">{text || '—'}</p>
      </div>
    </aside>
  )
}

/* ------------------------------------------------------------------ the part */

/**
 * Every station of a plan as the plate draws it (B9: Preflight's "Kette bereit" card draws the same): its project, where
 * it stops under this device's Approvals, the next step, a QA branch shared with a coding step, its key in the seen book.
 */
export function useStations(rowId: ID, rec: OrderRecord, draft: OrderDraft) {
  const databases = useWorkspace((s) => s.databases)
  const db = useWorkspace((s) => (s.pages[rowId]?.databaseId ? s.databases[s.pages[rowId]!.databaseId!] : undefined))
  const read = readOrderConfig(db)
  const config = read.kind === 'ok' ? read.config : null
  const checkpoint = config?.checkpoint ?? true
  const approvals = defaultApprovals()
  const projects = useMemo(() => kindProjects(rowId), [rowId, databases]) // eslint-disable-line react-hooks/exhaustive-deps
  const base = rec.chain ? Math.max(...rec.chain.steps.map((s) => s.n)) : 0
  const steps = draft.plan.steps
  const stations = useMemo(() => {
    const stopSteps: StopStep[] = steps.map((st) => {
      const kp = projects.find((p) => p.kind === st.kind)
      const pipeline = kp?.pipeline ?? []
      return { kind: st.kind, stops: stopsOf(pipeline, !!st.repo, approvals), endsAtGate: endsAtGate(pipeline, !!st.repo, approvals) }
    })
    return {
      holds: holdsOf(stopSteps, checkpoint),
      list: steps.map((st, i): StationFacts => {
        const kp = projects.find((p) => p.kind === st.kind)
        const coding = st.kind === 'qa' && !st.branch && st.repo ? steps.slice(0, i).map((s, j) => ({ s, j })).reverse().find((x) => x.s.kind === 'coding' && x.s.repo === st.repo) : undefined
        const model = kp?.pipeline.find((s) => CLAUDE_STAGES.has(s.kind) && s.model)?.model ?? null
        return {
          n: base + i + 1,
          step: st,
          kp,
          stops: stopSteps[i]!.stops,
          checkpoint: checkpointAfter(stopSteps, i, checkpoint),
          next: steps[i + 1] ? { n: base + i + 2, step: steps[i + 1]! } : null,
          sharedFrom: coding ? base + coding.j + 1 : null,
          model,
          key: keyOf(JSON.stringify(st)),
        }
      }),
    }
  }, [steps, projects, approvals, checkpoint, base])
  return { stations, projects, base, config, databases }
}

export default function ReadyPart({ rowId, rec, pre, headId, viewer, elsewhere, onNote }: { rowId: ID; rec: OrderRecord; pre: OrderPreResult; headId: string; viewer: boolean; elsewhere: boolean; onNote: (n: string | null) => void }) {
  const t = useT()
  const lang = useLang()
  const draft = rec.draft!
  const root = useRef<HTMLDivElement>(null)
  const repos = useCoding((s) => (s.worker?.repos ?? []).map((r) => r.name).join('\n'))
  const repoList = useMemo(() => (repos ? repos.split('\n') : []), [repos])
  const { stations, projects, base, config, databases } = useStations(rowId, rec, draft)
  const usableKinds = projects.filter((p) => !p.problem).map((p) => p.kind)
  const server = draft.source.server
  const steps = draft.plan.steps

  // what ↵ confirms: the plan as it resolves now
  const [hash, setHash] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    void planHashNow(rowId, draft).then((h) => live && setHash(h))
    return () => {
      live = false
    }
  }, [rowId, draft, databases])

  // seen in full: every station (both edges) and every page fold; the server's context too
  const book = useSeenBook(`${rowId}:${draft.run}`)
  const ctxKey = draft.plan.context ? keyOf(JSON.stringify(draft.plan.context)) : null
  const unseen = stations.list.filter((s) => !book.whole(s.key)).map((s) => stepNo(s.n))
  const unfolded = stations.list.flatMap((s) => s.step.refs.filter((id) => !book.has(`fold:${s.key}:${id}`)).map((id) => ({ n: s.n, id })))
  const ctxUnseen = !!server && !!ctxKey && !book.whole(`ctx:${ctxKey}`)
  const noRepo = stations.list.find((s) => s.step.kind === 'coding' && !s.step.repo)

  const [editing, setEditing] = useState<number | null>(null)
  const [pending, setPending] = useState(false)
  const [undo, setUndo] = useState<{ prev: OrderDraft; after: OrderDraft } | null>(null)
  const focusTarget = useRef<number | 'head' | 'start' | null>(null)

  const titleOf = (id: ID) => {
    const p = useWorkspace.getState().pages[id]
    return !p ? t('common.untitled') : p.private ? t(`${O}.plan.privatePage`) : p.title.trim() || t('common.untitled')
  }
  const reason: string | undefined = !pre.ok
    ? preWhyText(pre.why, pre.left)
    : editing !== null
      ? t(`${O}.start.why.editing`)
      : noRepo
        ? t(`${O}.plan.openRepo`, { n: stepNo(noRepo.n) })
        : ctxUnseen
          ? t(`${O}.start.why.context`)
          : unseen.length
            ? t(`${O}.start.why.unseen`, { list: unseen.join(', ') })
            : unfolded.length
              ? t(`${O}.start.why.folds`, { list: unfolded.map((u) => `${stepNo(u.n)}: ${titleOf(u.id)}`).join(' · ') })
              : !hash
                ? t(`${O}.key.readying`)
                : undefined
  const ready = !reason && !pending

  const focusHead = () => window.setTimeout(() => document.getElementById(headId)?.focus(), 0)
  const focusStation = (i: number) =>
    window.setTimeout(() => {
      const list = root.current?.querySelectorAll<HTMLElement>('.orc-station__bar')
      if (!list?.length) return focusHead()
      list[Math.max(0, Math.min(i, list.length - 1))]!.focus()
    }, 0)
  // after an edit lands, focus goes where the key said
  useEffect(() => {
    const target = focusTarget.current
    if (target === null) return
    focusTarget.current = null
    if (typeof target === 'number') focusStation(target)
    else if (target === 'head') focusHead()
  }, [draft]) // eslint-disable-line react-hooks/exhaustive-deps

  const said = (out: EditOutcome): string | null => (out.ok ? null : out.why === 'plan' ? t(`${O}.edit.why.plan`, { problem: out.problem }) : t(`${O}.edit.why.${out.why}`))

  const start = useCallback(async () => {
    if (!hash || pending) return
    setPending(true)
    const out = await startChain(rowId, hash)
    setPending(false)
    if (!out.ok) {
      onNote(refusalText(out, t))
      if (out.why === 'changed') void planHashNow(rowId, draft).then(setHash)
      return
    }
    onNote(null)
    focusHead()
  }, [hash, pending, rowId, draft, t, onNote]) // eslint-disable-line react-hooks/exhaustive-deps

  const discard = () => {
    if (viewer) return
    writeOrderStatus(rowId, 'draft', YOU)
    focusHead()
  }
  const replan = (noServer = false) => {
    if (viewer) return
    const go = () => {
      void import('./plan').then((m) => m.planOrder(rowId, { mode: 'manual', replace: true, ...(noServer ? { noServer: true } : {}) }))
      focusHead()
    }
    if (!draft.edited) return go()
    useUI.getState().openModal({ type: 'confirm', title: t('features.coding.order.planner.why.edited'), body: t(`${O}.ask.replan.body`), confirmLabel: t(`${O}.key.replan`), onConfirm: go })
  }
  const remove = async (i: number) => {
    const out = await removeStep(rowId, i)
    if (!out.ok) return onNote(said(out))
    onNote(null)
    setUndo({ prev: out.before, after: out.draft })
    focusTarget.current = i
    useUI.getState().toast({
      message: t(`${O}.removed`, { n: stepNo(base + i + 1) }),
      kind: 'info',
      action: { label: t('common.undo'), undo: true, kbd: 'Z', run: () => void restoreDraft(rowId, out.before, out.draft) },
    })
  }
  const move = async (i: number, by: -1 | 1) => {
    const out = await moveStep(rowId, i, by)
    if (!out.ok) return
    focusTarget.current = i + by
  }
  // Fix 2: while a step is being edited, no other station is removed or moved (the edit would land on another step) —
  // said in the plate's note; the edit is finished (Save / Esc) first
  const editingNote = () => onNote(t(`${O}.edit.finishFirst`, { n: stepNo(base + (editing ?? 0) + 1) }))
  const removeKey = (i: number) => (editing !== null ? editingNote() : remove(i))
  const moveKey = (i: number, by: -1 | 1) => (editing !== null ? editingNote() : move(i, by))
  const pickRepo = async (i: number, repo: string) => {
    const out = await editStep(rowId, i, { repo })
    onNote(said(out))
  }
  const saveEdit = (i: number) => async (patch: StepPatch) => {
    const out = await editStep(rowId, i, patch)
    if (!out.ok) return said(out)
    setEditing(null)
    focusTarget.current = i
    return null
  }

  // the keys (focus inside the plate; never while typing, on a repeat, or with a modifier but ⇧ — Alt for the moves)
  const keys = useRef<(e: KeyboardEvent) => void>(() => {})
  keys.current = (e: KeyboardEvent) => {
    if (e.repeat || e.ctrlKey || e.metaKey || viewer) return
    const el = e.target as HTMLElement
    // a dialog around the plate (the side peek) never owns its keys — a field, a menu / dialog inside it does (Fix 2)
    if (typingWithin(el, root.current?.closest('section') ?? null) || el.closest('.orc-edit')) return
    const at = el.closest<HTMLElement>('[data-station]')
    const i = at ? Number(at.dataset.station) : -1
    if (e.altKey) {
      if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && i >= 0) {
        e.preventDefault()
        void moveKey(i, e.key === 'ArrowUp' ? -1 : 1)
      }
      return
    }
    const onKey = !!el.closest('button, a, [role="button"], summary, select')
    const k = e.key.toLowerCase()
    if (k === 'z' && undo) {
      e.preventDefault()
      const u = undo
      setUndo(null)
      void restoreDraft(rowId, u.prev, u.after)
      return
    }
    if (elsewhere) {
      if (k === 'd') {
        e.preventDefault()
        discard()
      }
      return
    }
    switch (k) {
      case 'd':
        e.preventDefault()
        return discard()
      case 'r':
        e.preventDefault()
        return replan(false)
      case 'o':
        if (!server) return
        e.preventDefault()
        return replan(true)
      case 'e':
        e.preventDefault()
        return setEditing(Math.max(0, i))
      case 'delete':
      case 'backspace':
        // Backspace too: the key a Mac keyboard labels "delete"
        if (i < 0) return
        e.preventDefault()
        return void removeKey(i)
      case 'enter':
        if (onKey) return
        e.preventDefault()
        root.current?.querySelector<HTMLElement>('[data-testid="order-start"]')?.focus()
        return
    }
  }
  useEffect(() => {
    const plate = root.current?.closest('section')
    if (!plate) return
    const on = (e: Event) => keys.current(e as KeyboardEvent)
    plate.addEventListener('keydown', on)
    return () => plate.removeEventListener('keydown', on)
  }, [])

  const older = olderParked(rec)
  const cost = draft.receipt ? costText(t, lang, draft.receipt.usd, draft.receipt.costSource) : null
  const counter = [t(`${O}.plan.steps.${steps.length === 1 ? 'one' : 'other'}`, { n: steps.length }), stations.holds === 0 ? t(`${O}.ready.holds.none`) : t(`${O}.ready.holds.${stations.holds === 1 ? 'one' : 'other'}`, { n: stations.holds }), ...(cost ? [cost] : [])].join(' · ')
  // Claude Code so far, per kind in the plan (the Cost fields of done tasks — a display, never a guard)
  const costs = [...new Set(steps.map((s) => s.kind))].flatMap((kind) => {
    const kp = projects.find((p) => p.kind === kind)
    const avg = projectAvgCost(kp?.project ?? null)
    return avg ? [t(`${O}.plan.cost.kind`, { usd: fmtUsd(avg.avg, lang), kind: t(`features.coding.pipe.${kind}`) })] : []
  })
  const foreign = !!server
  const reasonId = `orc-why-${rowId}`

  return (
    <div className="orc-ready" ref={root} data-testid="order-ready">
      <p className="label orc-counter" data-testid="order-counter">
        {counter}
      </p>
      {/* Orders B11: "Ohne Bestätigung starten" left this plan here — and why */}
      {!!draft.auto?.reasons.length && (
        <p className="orc-line orc-line--warn" data-testid="order-auto-fallback">
          {autoFallbackText(draft.auto.reasons, t, { row: rowId, titleOf: quoteTitleOf })}
        </p>
      )}
      {draft.plan.summary && (
        <p className="orc-understood" data-testid="order-understood">
          <span className="label">{t(`${O}.plan.understood`)}</span> {draft.plan.summary}
        </p>
      )}
      {(draft.notes ?? []).length > 0 && (
        <ul className="orc-notes" data-testid="order-notes">
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
      <div className="orc-ready__grid">
        <ol className="orc-stations" data-testid="order-plan-steps">
          {stations.list.map((f, i) => (
            <Station
              key={`${i}:${f.key}`}
              facts={f}
              index={i}
              draft={draft}
              book={book}
              viewer={viewer}
              repos={repoList}
              onEdit={(x) => setEditing(x)}
              onRepo={(x, r) => void pickRepo(x, r)}
              onRemove={(x) => void removeKey(x)}
              onMove={(x, by) => void moveKey(x, by)}
              count={stations.list.length}
              editing={
                editing === i ? (
                  <StepEditor
                    facts={f}
                    repos={repoList}
                    kinds={[...new Set([...usableKinds, f.step.kind])]}
                    onSave={saveEdit(i)}
                    onCancel={() => {
                      setEditing(null)
                      focusStation(i)
                    }}
                  />
                ) : null
              }
            />
          ))}
        </ol>
        <RequestPanel rowId={rowId} draft={draft} />
      </div>
      {older.length > 0 && (
        <p className="orc-line" data-testid="order-plan-older">
          {t(`${O}.plan.older`, { list: older.length > 1 ? `${stepNo(older[0]!.n)}–${stepNo(older[older.length - 1]!.n)}` : stepNo(older[0]!.n) })}
        </p>
      )}
      {(draft.plan.questions.length > 0 || noRepo) && (
        <div className="orc-open" data-testid="order-open">
          <p className="label">{t(`${O}.plan.open`)}</p>
          <ul>
            {stations.list
              .filter((s) => s.step.kind === 'coding' && !s.step.repo)
              .map((s) => (
                <li key={s.n}>{t(`${O}.plan.openRepo`, { n: stepNo(s.n) })}</li>
              ))}
          </ul>
          {draft.plan.questions.length > 0 && !viewer && <QuestionsForm rowId={rowId} draft={draft} />}
        </div>
      )}
      <p className="orc-line orc-cost" data-testid="order-cost">
        {costs.length ? `${t(`${O}.plan.cost.head`)} ${costs.join(' · ')} ${t(`${O}.plan.cost.last`, { n: COST_SAMPLE })} · ${t(`${O}.plan.cost.notCapped`)}` : t(`${O}.plan.costNone`)}
      </p>
      <BudgetField rowId={rowId} draft={draft} configUsd={config?.budgetUsd} viewer={viewer} />
      {elsewhere && (
        <p className="orc-line orc-line--warn" data-testid="order-elsewhere">
          {t(`${O}.why.elsewhere`)}
        </p>
      )}
      {!viewer && (
        <div className="orp-keys orc-keys" data-bar="" data-testid="order-keys">
          <OrderSettingsKey rowId={rowId} />
          <button type="button" className="btn btn--sm" onClick={discard} data-testid="order-discard">
            <span className="kbd" aria-hidden>
              D
            </span>
            <Trash2 size={13} strokeWidth={1.75} aria-hidden />
            {t(`${O}.key.discard`)}
          </button>
          {!elsewhere && (
            <>
              <button type="button" className="btn btn--sm" onClick={() => replan(false)} data-testid="order-plan">
                <span className="kbd" aria-hidden>
                  R
                </span>
                {t(`${O}.key.replan`)}
              </button>
              {server && (
                <button type="button" className="btn btn--sm" onClick={() => replan(true)} data-testid="order-plan-noserver">
                  <span className="kbd" aria-hidden>
                    O
                  </span>
                  {t(`${O}.key.noServer`)}
                </button>
              )}
              <HandKey ready={ready} reason={reason} describedBy={reason ? reasonId : undefined} onPress={() => void start()} primary testId="order-start">
                <span className="kbd" aria-hidden>
                  ↵
                </span>
                {t(foreign ? `${O}.key.startForeign` : `${O}.key.start`)}
              </HandKey>
            </>
          )}
        </div>
      )}
      {!viewer && !elsewhere && reason && (
        <p className="orc-line orc-line--quiet orc-why" id={reasonId} data-testid="order-start-why">
          {reason}
        </p>
      )}
      <p className="orc-line orc-line--quiet orc-keyhint" aria-hidden>
        {t(`${O}.ready.keys`)}
      </p>
    </div>
  )
}

/** A note of the planner's reader, in words (plannerMessages note.*). */
export function noteText(n: NonNullable<OrderDraft['notes']>[number], t: Tr): string {
  const P = 'features.coding.order.planner.note'
  switch (n.kind) {
    case 'repo':
      return t(`${P}.repo`, { n: stepNo(n.step), repo: n.repo })
    case 'branch':
      return t(`${P}.branch`, { n: stepNo(n.step), branch: n.branch })
    case 'refs':
      return t(`${P}.refs.${n.count === 1 ? 'one' : 'other'}`, { n: stepNo(n.step), count: n.count })
    case 'links':
      return n.step === null ? t(`${P}.planLinks.${n.count === 1 ? 'one' : 'other'}`, { count: n.count }) : t(`${P}.links.${n.count === 1 ? 'one' : 'other'}`, { n: stepNo(n.step), count: n.count })
    case 'keys':
      return n.step === null ? t(`${P}.planKeys.${n.count === 1 ? 'one' : 'other'}`, { count: n.count }) : t(`${P}.keys.${n.count === 1 ? 'one' : 'other'}`, { n: stepNo(n.step), count: n.count })
    case 'context':
      return t(`${P}.context.${n.why}`)
  }
}
