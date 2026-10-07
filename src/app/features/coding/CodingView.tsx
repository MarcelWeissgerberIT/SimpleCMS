/**
 * #/coding — the coding pipeline: the worker's state (LED, name, repos, today's cost, what runs), the tasks
 * that wait for the person (gates, questions, failures), the board of the Coding database (grouped by
 * Stage), New task and the pipeline editor. Loaded on first visit.
 */
import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Plus, Settings2, Workflow } from 'lucide-react'
import { useWorkspace } from '../../store/store'
import { useRowCount } from '../../store/selectors'
import { useUI } from '../../store/ui'
import { useCloud } from '../../cloud'
import { DatabaseView } from '../../database'
import { Led } from '../../ui/controls'
import { useLang, useT } from '../../i18n'
import { HelpLink } from '../../help'
import { navigate } from '../../lib/router'
import { codingDbId, ensureCodingDb } from './schema'
import { useCoding } from './state'
import { allTasks } from './tasks'
import { loadTask, useCodingLocal, scope } from './local'
import { openCodingSettings } from './open'
import { NewTaskDialog } from './NewTaskDialog'
import { PipelineEditor } from './PipelineEditor'
import { workerStateText } from './stateText'
import { ChangeReposButton, SetupCard } from './SetupCard'
import { NowLine } from './NowLine'
import './coding.css'

function WorkerPlate() {
  const t = useT()
  const lang = useLang()
  const s = useCoding()
  const pages = useWorkspace((x) => x.pages)
  const money = (n: number) => n.toLocaleString(lang === 'de' ? 'de-DE' : 'en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })
  const connected = s.enabled && s.conn === 'connected'
  // not connected, or no repos ticked yet: the three steps instead
  if (!connected || !s.worker?.repos.length)
    return (
      <div className="cv-setup" data-testid="coding-worker">
        <SetupCard code="§ W" />
      </div>
    )
  return (
    <section className="cv-plate" aria-label={t('features.coding.worker.label')} data-testid="coding-worker">
      <div className="cv-plate__lead">
        <div className="cv-plate__state">
          <Led state={s.busy.length ? 'on' : 'ok'} />
          <span className="label">{workerStateText(t, s)}</span>
        </div>
        <ChangeReposButton className="btn btn--ghost btn--sm cv-plate__change" />
      </div>
      <dl className="cv-plate__ro">
        <div>
          <dt className="label">{t('features.coding.ro.worker')}</dt>
          <dd>{s.worker.name}</dd>
        </div>
        <div>
          <dt className="label">{t('features.coding.ro.repos')}</dt>
          <dd className="cv-repos">
            {s.worker.repos.map((r) => (
              <code key={r.name} title={t('features.coding.ro.base', { base: r.baseBranch })}>
                {r.name}
              </code>
            ))}
          </dd>
        </div>
        <div>
          <dt className="label">{t('features.coding.ro.today')}</dt>
          <dd>
            {money(s.spentToday)}
            {s.worker.dayLimit !== null && <span className="faint"> / {money(s.worker.dayLimit)}</span>}
          </dd>
        </div>
        <div>
          <dt className="label">{t('features.coding.ro.running')}</dt>
          <dd>
            {s.busy.length
              ? s.busy.map((b) => (
                  <div key={b.taskId} className="cv-busy">
                    <a href={`#/p/${b.taskId}`} className="cv-run">
                      {pages[b.taskId]?.title.trim() || t('common.untitled')}
                    </a>
                    <NowLine taskId={b.taskId} />
                  </div>
                ))
              : t('features.coding.ro.idle')}
          </dd>
        </div>
      </dl>
    </section>
  )
}

/** The tasks that wait for the person: a gate, a question, a failure. */
function NeedsYou() {
  const t = useT()
  const pages = useWorkspace((s) => s.pages)
  const dbs = useWorkspace((s) => s.databases)
  const local = useCodingLocal((s) => s.tasks)
  const tasks = useMemo(() => allTasks(), [pages, dbs]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    for (const x of tasks) void loadTask(x.row.id)
  }, [tasks])
  const sc = scope()
  const waiting = tasks
    .map((x) => {
      const st = local[`${sc}|${x.row.id}`]?.state
      const why = st === 'question' ? 'question' : st === 'failed' ? 'failed' : x.stage?.kind === 'gate' ? 'gate' : null
      return why ? { ...x, why } : null
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
  if (!waiting.length) return null
  return (
    <section className="cv-needs" aria-labelledby="cv-needs-title" data-testid="coding-needs">
      <h2 id="cv-needs-title" className="label">
        {t('features.coding.needs.title', { n: waiting.length })}
      </h2>
      <ul>
        {waiting.map((x) => (
          <li key={x.row.id}>
            <span className="cv-why label" data-why={x.why}>
              {t(`features.coding.needs.${x.why}`)}
            </span>
            <a href={`#/p/${x.row.id}`} className="cv-needs__title">
              {x.row.title.trim() || t('common.untitled')}
            </a>
            <span className="cv-needs__meta label">
              {x.repo ?? '—'} · {x.stage?.name ?? '—'}
            </span>
            <ArrowRight size={14} strokeWidth={1.75} aria-hidden className="cv-needs__go" />
          </li>
        ))}
      </ul>
    </section>
  )
}

export default function CodingView() {
  const t = useT()
  const dbId = useWorkspace(() => codingDbId())
  const readOnly = useCloud((s) => s.readOnly)
  const count = useRowCount(dbId)
  const [newTask, setNewTask] = useState(false)
  const [pipeline, setPipeline] = useState(false)
  const locked = useWorkspace((s) => (dbId ? !!s.databases[dbId]?.locked : false))

  const setUp = () => {
    try {
      const id = ensureCodingDb()
      useUI.getState().toast({ message: t('features.coding.setup.done'), kind: 'success' })
      return id
    } catch {
      useUI.getState().toast({ message: t('features.coding.setup.readOnly'), kind: 'error' })
      return null
    }
  }

  return (
    <div className="cv">
      <header className="cv-head">
        <div className="cv-head__meta label">
          <span className="cv-head__sec">§ CD</span>
          <span>{t('features.coding.kicker')}</span>
          <span className="cv-head__rule" aria-hidden />
          <span className="mono" data-testid="coding-count">
            {t(count === 1 ? 'features.coding.count.one' : 'features.coding.count.other', { n: String(count).padStart(2, '0') })}
          </span>
          <HelpLink id="coding-pipeline" />
        </div>
        <div className="cv-head__row">
          <h1 className="cv-title">{t('features.coding.title')}</h1>
          {!readOnly && (
            <div className="cv-keys">
              {dbId && (
                <button type="button" className="btn" onClick={() => setPipeline(true)} data-testid="coding-pipeline-open">
                  <Workflow size={14} strokeWidth={1.8} aria-hidden /> {t('features.coding.pipeline.open')}
                </button>
              )}
              <button type="button" className="btn btn--ghost" onClick={openCodingSettings}>
                <Settings2 size={14} strokeWidth={1.8} aria-hidden /> {t('features.coding.worker.settings')}
              </button>
              <button type="button" className="btn btn--primary" onClick={() => setNewTask(true)} data-testid="coding-new">
                <Plus size={14} strokeWidth={1.9} aria-hidden /> {t('features.coding.new')}
              </button>
            </div>
          )}
        </div>
        <p className="cv-lead">{t('features.coding.lead')}</p>
      </header>

      <WorkerPlate />
      <NeedsYou />

      {dbId ? (
        <section className="cv-board" aria-label={t('features.coding.board')}>
          <div className="cv-board__head">
            <span className="label">{t('features.coding.board')}</span>
            <a className="ctk-link" href={`#/p/${dbId}`}>
              {t('features.coding.openDb')}
            </a>
          </div>
          <DatabaseView databaseId={dbId} inline />
        </section>
      ) : (
        <section className="cv-empty">
          <p>{t('features.coding.empty')}</p>
          {!readOnly && (
            <button type="button" className="btn" onClick={() => setUp()} data-testid="coding-setup">
              {t('features.coding.setup.button')}
            </button>
          )}
        </section>
      )}

      {newTask && (
        <NewTaskDialog
          onClose={() => setNewTask(false)}
          onCreated={(id) => {
            setNewTask(false)
            navigate({ name: 'page', id })
          }}
        />
      )}
      {pipeline && dbId && <PipelineEditor dbId={dbId} locked={locked} onClose={() => setPipeline(false)} />}
    </div>
  )
}
