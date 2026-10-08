/**
 * AI terminal — the review of a pipeline task change (kind 'coding', features/ai/agent/coding.ts): a new task shows
 * ALL of what it will be — project, repo, branch, where it starts and stops, and its whole page exactly as Claude Code
 * will read it (a scroll box, plain text) plus the pages that go along; a task action shows what it does and, for an
 * approval, what is being approved (Claude Code's plan, the tests) and what runs on its own after it. Never the
 * shortened content preview (ReviewParts.Preview): what the person applies is what they saw.
 */
import { useEffect, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { useT } from '../../../i18n'
import { useWorkspace } from '../../../store/store'
import { openPage } from '../../../lib/router'
import { startsNow, taskNeedsConfirm, useCoding, useCodingTaskLocal } from '../../coding'
import { closeAgent } from './state'
import type { StagedChange } from './types'

const isPhone = () => window.matchMedia?.('(max-width: 640px)').matches ?? false

/** the actions a task must be trusted for (the rest never needs Confirm) */
const NEEDS_TRUST = new Set(['approve', 'rework', 'answer', 'run', 'hand_on'])

/** Does the task of a staged action wait for "Confirm on this device" — now (re-checked when the task changes)? */
function useNeedsConfirm(taskId: string | null): boolean {
  const row = useWorkspace((s) => (taskId ? s.pages[taskId] : undefined))
  const db = useWorkspace((s) => (row?.databaseId ? s.databases[row.databaseId] : undefined))
  const [waits, setWaits] = useState(false)
  useEffect(() => {
    if (!taskId) return setWaits(false)
    let alive = true
    void taskNeedsConfirm(taskId).then((v) => alive && setWaits(v))
    return () => {
      alive = false
    }
  }, [taskId, row, db])
  return waits
}

/** A coding change's flags for the review's head line: it starts the worker · its task waits for Confirm (both live). */
export function useCodingFlags(c: StagedChange): { starts: boolean; confirm: boolean } {
  const cd = c.kind === 'coding' ? c.coding : undefined
  const open = c.status === 'pending' || c.status === 'failed'
  // the task's local state (a question, approvals) can change what an action starts: re-read with it
  useCodingTaskLocal(cd?.action?.taskId ?? '')
  useWorkspace((s) => (cd?.action ? s.pages[cd.action.taskId] : undefined))
  const confirm = useNeedsConfirm(cd?.action && open && NEEDS_TRUST.has(cd.op) ? cd.action.taskId : null)
  if (!cd) return { starts: false, confirm: false }
  return { starts: open ? startsNow(cd) : cd.starts, confirm }
}

function Row({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <div className="agent-diff__row">
      <dt className="agent-diff__name">{name}</dt>
      <dd className="agent-diff__vals">{children}</dd>
    </div>
  )
}

const Tag = ({ kind, children }: { kind: 'starts' | 'confirm' | 'branch' | 'nostops'; children: React.ReactNode }) => (
  <span className="term-tag" data-tag={kind}>
    {children}
  </span>
)

/** A box of text that goes to (or came from) Claude Code: all of it, plain, scrollable, focusable. */
function FullText({ label, hint, text, testId }: { label: string; hint?: string; text: string; testId: string }) {
  return (
    <div className="term-full">
      <span className="term-full__label">{label}</span>
      <pre className="term-full__text" tabIndex={0} aria-label={label} data-testid={testId}>
        {text}
      </pre>
      {hint && <span className="term-full__hint">{hint}</span>}
    </div>
  )
}

/** The review body of a pipeline task change. */
export function CodingDiff({ change: c }: { change: StagedChange }) {
  const t = useT()
  const conn = useCoding((s) => s.conn)
  const { starts, confirm } = useCodingFlags(c)
  const cd = c.coding
  if (!cd) return null
  const pending = c.status === 'pending' || c.status === 'failed'
  const kinds = (list: string[]) => list.map((k) => t(`features.coding.pipe.${k}`)).join(', ') || '—'
  const refsLine = (refs: Array<{ title: string }> | undefined) =>
    refs?.length ? <p className="term-change__hint" data-testid="term-coding-refs">{t('features.agent.coding.refs', { titles: refs.map((r) => `“${r.title}”`).join(', ') })}</p> : null
  let body: React.ReactNode = null

  if (cd.op === 'create' && cd.task) {
    const p = cd.task
    const noStops = p.approvals === 'none' && p.git.length > 0
    body = (
      <>
        <dl className="agent-diff" data-kind="coding">
          <Row name={t('features.agent.coding.project')}>
            <span className="agent-diff__after">{p.newProject ? t('features.agent.coding.newProject', { kind: t(`features.coding.pipe.${p.kind}`) }) : p.project}</span>
          </Row>
          <Row name={t('features.agent.coding.repo')}>
            <span className="agent-diff__after">{p.repo ?? t('features.agent.coding.noRepo')}</span>
            {p.repo && !p.repoKnown && <span className="agent-diff__new label">{t('features.agent.coding.repoUnknown')}</span>}
          </Row>
          {p.kind === 'coding' && (
            <Row name={t('features.agent.coding.branch')}>
              <span className="agent-diff__after">{p.branch ?? t('features.agent.coding.newBranch')}</span>
              {p.existingBranch && <Tag kind="branch">{t('features.agent.coding.existingBranch')}</Tag>}
            </Row>
          )}
          <Row name={t('features.agent.coding.priority')}>
            <span className="agent-diff__after">{t(`features.coding.priority.${p.priority}`)}</span>
          </Row>
          {p.then.length > 0 && (
            <Row name={t('features.agent.coding.then')}>
              <span className="agent-diff__after">{t('features.agent.coding.thenStarts', { kinds: kinds(p.then) })}</span>
            </Row>
          )}
          <Row name={t('features.agent.coding.start')}>
            <span className="agent-diff__after" data-testid="term-coding-start">
              {t(p.starts ? 'features.agent.coding.start.now' : 'features.agent.coding.start.backlog', { stage: p.startStage ?? '—' })}
            </span>
          </Row>
          <Row name={t('features.agent.coding.stopsAt')}>
            <span className="agent-diff__after">{p.stopsAt ?? t('features.agent.coding.stopsAtNone')}</span>
            {noStops && <Tag kind="nostops">{t('features.agent.coding.noStops')}</Tag>}
          </Row>
          {p.git.length > 0 && (
            <Row name={t('features.agent.coding.gitStages')}>
              <span className="agent-diff__after">{p.git.map((g) => `${g.name}: ${t(`features.coding.gitAction.${g.action}`)}`).join(' · ')}</span>
            </Row>
          )}
        </dl>
        {p.existingBranch && <p className="term-change__hint">{t('features.agent.coding.existingHint')}</p>}
        {noStops && <p className="term-change__hint" data-tone="signal">{t('features.agent.coding.noStopsHint')}</p>}
        <FullText label={t('features.agent.coding.full')} hint={t('features.agent.coding.fullHint')} text={`# ${p.title}\n\n${p.text}`} testId="term-coding-full" />
        {refsLine(p.refs)}
      </>
    )
  } else if (cd.action) {
    const a = cd.action
    const stage = a.stage ?? '—'
    switch (a.op) {
      case 'approve':
      case 'rework':
        body = (
          <>
            <dl className="agent-diff" data-kind="coding">
              <Row name={t('features.agent.coding.stage')}>
                <span className="agent-diff__before">{stage}</span>
                <span className="agent-diff__arrow" aria-hidden>
                  →
                </span>
                <span className="agent-diff__after">{a.to ?? '—'}</span>
              </Row>
              {a.op === 'approve' && a.test && (
                <Row name={t('features.agent.coding.tests')}>
                  <span className="agent-diff__after">{a.test.skipped ? t('features.agent.coding.testsNone') : a.test.ok ? t('features.agent.coding.testsOk') : t('features.agent.coding.testsFail', { code: a.test.code ?? '—' })}</span>
                  {a.files ? <span className="agent-diff__new label">{t(`features.agent.coding.files.${a.files === 1 ? 'one' : 'other'}`, { count: a.files })}</span> : null}
                </Row>
              )}
              {a.op === 'approve' && (a.runs?.length ?? 0) > 0 && (
                <Row name={t('features.agent.coding.runs')}>
                  <span className="agent-diff__after">{a.runs!.map((r) => (r.gitAction ? `${r.name} (${t(`features.coding.gitAction.${r.gitAction}`)})` : r.name)).join(' → ')}</span>
                </Row>
              )}
              {a.op === 'approve' && (
                <Row name={t('features.agent.coding.stopsAt')}>
                  <span className="agent-diff__after">{a.stopsAt ?? t('features.agent.coding.stopsAtNone')}</span>
                </Row>
              )}
              {a.op === 'approve' && (a.spawns?.length ?? 0) > 0 && (
                <Row name={t('features.agent.coding.then')}>
                  <span className="agent-diff__after">{t('features.agent.coding.spawns', { kinds: kinds(a.spawns!) })}</span>
                </Row>
              )}
            </dl>
            {a.op === 'approve' && a.approves === 'plan' && (a.output ? <FullText label={t('features.agent.coding.approveShows')} text={a.output} testId="term-coding-output" /> : <p className="term-change__hint">{t('features.agent.coding.noOutput')}</p>)}
            {a.op === 'rework' && a.note && <FullText label={t('features.agent.coding.note')} text={a.note} testId="term-coding-note" />}
            {refsLine(a.refs)}
          </>
        )
        break
      case 'answer':
        body = (
          <>
            <FullText label={t('features.agent.coding.question')} text={a.question ?? ''} testId="term-coding-question" />
            <FullText label={t('features.agent.coding.answer')} text={a.answer ?? ''} testId="term-coding-answer" />
            {refsLine(a.refs)}
          </>
        )
        break
      case 'run':
        body = <p className="term-change__line">{t(a.retry ? 'features.agent.coding.retry' : 'features.agent.coding.run', { stage, state: t(`features.coding.state.${a.phase}`) })}</p>
        break
      case 'stop':
        body = <p className="term-change__line">{t('features.agent.coding.stop', { stage })}</p>
        break
      case 'then':
        body = (
          <dl className="agent-diff" data-kind="coding">
            <Row name={t('features.agent.coding.then')}>
              <span className="agent-diff__before">{kinds(a.then?.before ?? [])}</span>
              <span className="agent-diff__arrow" aria-hidden>
                →
              </span>
              <span className="agent-diff__after">{kinds(a.then?.after ?? [])}</span>
            </Row>
          </dl>
        )
        break
      case 'hand_on':
        body = <p className="term-change__line">{t('features.agent.coding.handOn', { kind: t(`features.coding.pipe.${a.handOn ?? 'coding'}`) })}</p>
        break
    }
  }

  const taskId = cd.action?.taskId ?? null
  return (
    <>
      {body}
      {pending && starts && <p className="term-change__hint" data-tone="signal">{t('features.agent.coding.startsHint')}</p>}
      {pending && starts && conn !== 'connected' && <p className="term-change__hint">{t('features.agent.coding.offline')}</p>}
      {pending && confirm && taskId && (
        <p className="term-change__hint term-change__hint--keys" data-testid="term-coding-confirm">
          <span>{t('features.agent.coding.confirmHint')}</span>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => {
              openPage(taskId)
              if (isPhone()) closeAgent()
            }}
          >
            <ExternalLink size={12} strokeWidth={1.75} aria-hidden /> {t('features.agent.coding.openTask')}
          </button>
        </p>
      )}
    </>
  )
}
