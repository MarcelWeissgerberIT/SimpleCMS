/**
 * AI terminal — /pipelines [kind]: the open tasks of the coding pipelines, what needs you first (a question, a gate,
 * Confirm on this device, a failure), grouped by pipeline and project, live while it is the newest such readout (an
 * older one keeps what it showed). Open goes to the task page; Stop ends a running stage — the person's own click,
 * like the task panel's keys. Nothing here acts for Claude: actions are staged by task_action and applied in the review.
 */
import { useEffect } from 'react'
import { CircleStop, ExternalLink } from 'lucide-react'
import { useT } from '../../../i18n'
import { useUI } from '../../../store/ui'
import { useWorkspace } from '../../../store/store'
import { openPage } from '../../../lib/router'
import { codingWorkerStateText, hasPipelines, stopCodingTask, useCoding, useTaskBriefs, type TaskBrief } from '../../coding'
import { closeAgent, useAgent, type EchoEntry } from './state'

const isPhone = () => window.matchMedia?.('(max-width: 640px)').matches ?? false

/** What an older readout showed (memory of this tab): only the newest /pipelines is live. */
const shown = new Map<string, { total: number; list: TaskBrief[] }>()

const LED: Record<string, string> = { running: 'led led--on ai-led--live', question: 'led led--on', gate: 'led led--on', intake: 'led led--on', confirm: 'led led--on', failed: 'led ai-led--err', stopped: 'led ai-led--err', idle: 'led', done: 'led led--ok' }

export function PipelinesOut({ entry }: { entry: EchoEntry }) {
  const t = useT()
  const kind = entry.data?.pipe?.kind ?? null
  // the newest /pipelines readout is live; older ones show what they showed
  const live = useAgent((s) => s.echo.findLast((e) => e.kind === 'pipelines')?.id === entry.id)
  const fresh = useTaskBriefs({ status: 'open', ...(kind ? { kind } : {}) }, live)
  useEffect(() => {
    if (live && fresh) shown.set(entry.id, fresh)
  }, [live, fresh, entry.id])
  const data = live ? fresh : (shown.get(entry.id) ?? null)
  const worker = useCoding((s) => codingWorkerStateText(t, s))
  const any = useWorkspace(() => hasPipelines())
  if (!data) return <p className="term-pipes__wait">{t('features.agent.pipe.loading')}</p>
  // grouped by pipeline · project, in "what needs you first" order
  const groups: Array<{ key: string; label: string; rows: TaskBrief[] }> = []
  for (const b of data.list) {
    const key = `${b.kind}:${b.projectId}`
    let g = groups.find((x) => x.key === key)
    if (!g) groups.push((g = { key, label: `${t(`features.coding.pipe.${b.kind}.short`)} · ${b.project}`, rows: [] }))
    g.rows.push(b)
  }
  const open = (id: string) => {
    openPage(id)
    if (isPhone()) closeAgent()
  }
  const stop = (id: string) => void stopCodingTask(id).catch((e: unknown) => useUI.getState().toast({ message: e instanceof Error ? e.message : String(e), kind: 'error' }))
  return (
    <div className="term-pipes" data-testid="term-pipelines" data-live={live || undefined}>
      <p className="term-pipes__worker">{t('features.agent.pipe.worker', { state: worker })}</p>
      {!data.list.length && <p className="term-pipes__empty">{any ? t('features.agent.pipe.empty', { project: kind ? t(`features.coding.pipe.${kind}`) : t('features.agent.pipe.title') }) : t('features.agent.pipe.none')}</p>}
      {groups.map((g) => (
        <section key={g.key} className="term-pipes__group" aria-label={g.label}>
          <h4 className="term-pipes__head">{g.label}</h4>
          <ul className="term-pipes__list">
            {g.rows.map((b) => {
              const state = b.confirm ? 'confirm' : b.phase
              const label = b.confirm ? t('features.agent.pipe.confirm') : t(`features.coding.state.${b.phase}`)
              return (
                <li key={b.id} className="term-pipe" data-task={b.id} data-phase={b.phase} data-confirm={b.confirm || undefined}>
                  <span className="term-pipe__state">
                    <span className={LED[state] ?? 'led'} aria-hidden />
                    <span className="term-pipe__label">{label}</span>
                  </span>
                  <button type="button" className="term-pipe__title" onClick={() => open(b.id)} title={b.title}>
                    {b.title}
                  </button>
                  <span className="term-pipe__meta">{[b.repo, b.stage].filter(Boolean).join(' · ')}</span>
                  <span className="term-pipe__keys">
                    <button type="button" className="btn btn--ghost btn--sm" onClick={() => open(b.id)} aria-label={`${t('features.agent.review.open')} ${b.title}`}>
                      <ExternalLink size={12} strokeWidth={1.75} aria-hidden /> {t('features.agent.review.open')}
                    </button>
                    {b.phase === 'running' && (
                      <button type="button" className="btn btn--sm" onClick={() => stop(b.id)} aria-label={`${t('features.coding.act.stop')} ${b.title}`} data-testid="term-pipe-stop">
                        <CircleStop size={12} strokeWidth={1.75} aria-hidden /> {t('features.coding.act.stop')}
                      </button>
                    )}
                  </span>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
      {data.total > data.list.length && <p className="term-pipes__more">{t('features.agent.pipe.more', { count: data.total - data.list.length })}</p>}
      <p className="term-echo__note">{t('features.agent.pipe.hint')}</p>
    </div>
  )
}
