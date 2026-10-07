/**
 * New task of a pipeline (Coding · Business analysis · QA): title, repo (the names the worker announced and those
 * already in the database), goal, acceptance criteria (one per line), priority, an existing branch to reuse
 * (optional, Coding), "Then" (Business analysis / QA: the pipelines it hands on to), and whether the worker may start
 * right away (the first automatic queue — "Ready") or it waits in the backlog. The repo is optional for Business
 * analysis / QA (documents only) and for a pipeline that starts with an Import stage (the code arrives there).
 */
import { useId, useMemo, useState } from 'react'
import { Modal } from '../../ui/Modal'
import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import { useT } from '../../i18n'
import { useCoding } from './state'
import { FOLLOW_UPS, codingProps, currentProjectId, readPipeline, type PipelineKind } from './schema'
import { createTask, workerBranches, type NewTask } from './tasks'

export function NewTaskDialog({ onClose, onCreated, kind = 'coding' }: { onClose: () => void; onCreated: (id: string) => void; kind?: PipelineKind }) {
  const t = useT()
  const uid = useId()
  const worker = useCoding((s) => s.worker)
  const dbs = useWorkspace((s) => s.databases)
  // the project #/coding shows on this device: the new task goes there
  const [project] = useState(() => currentProjectId(kind))
  const known = useMemo(() => {
    const names = new Set((worker?.repos ?? []).map((r) => r.name))
    const dbId = project
    const db = dbId ? dbs[dbId] : undefined
    if (db) {
      const props = codingProps(db)
      for (const o of db.properties.find((p) => p.id === props.repo)?.options ?? []) names.add(o.name)
    }
    return [...names]
  }, [worker, dbs, project])
  // the code arrives in the task (an Import stage), or the pipeline writes documents: no repo needed
  const intake = useMemo(() => readPipeline(project ? dbs[project] : undefined).some((s) => s.kind === 'import'), [dbs, project])
  const repoOptional = kind !== 'coding' || intake
  const [then, setThen] = useState<PipelineKind[]>([])
  const [title, setTitle] = useState('')
  const [repo, setRepo] = useState(repoOptional ? '' : (known[0] ?? ''))
  const [goal, setGoal] = useState('')
  const [criteria, setCriteria] = useState('')
  const [priority, setPriority] = useState<NewTask['priority']>('medium')
  const [branch, setBranch] = useState('')
  const [start, setStart] = useState(true)
  // the worker's local branches of the chosen repo (names only) — picked or typed
  const branches = useMemo(() => workerBranches(repo.trim() || null).list, [worker, repo]) // eslint-disable-line react-hooks/exhaustive-deps
  const [saving, setSaving] = useState(false)
  const repoOk = repo.trim() ? /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(repo.trim()) : repoOptional
  const ok = title.trim().length > 0 && repoOk && (!branch.trim() || /^[A-Za-z0-9._/-]{1,200}$/.test(branch.trim()))

  const submit = async () => {
    if (!ok || saving) return
    setSaving(true)
    try {
      const id = await createTask({ kind, ...(project ? { dbId: project } : {}), title, repo: repo.trim() || null, goal, criteria: criteria.split('\n'), priority, branch: kind === 'coding' ? branch : '', start, followUps: then })
      onCreated(id)
    } catch (e) {
      useUI.getState().toast({ message: e instanceof Error && e.message === 'read-only' ? t('features.coding.setup.readOnly') : String(e), kind: 'error' })
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      label={`§ ${t(`features.coding.pipe.${kind}.short`)}`}
      title={t(kind === 'coding' ? 'features.coding.new.title' : `features.coding.new.title.${kind}`)}
      width={600}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn btn--primary" disabled={!ok || saving} onClick={() => void submit()} data-testid="coding-create">
            {t('features.coding.new.create')}
          </button>
        </>
      }
    >
      <form
        className="cn"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <label className="cn-field">
          <span className="label">{t('features.coding.new.name')}</span>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('features.coding.new.namePh')} maxLength={200} autoFocus data-testid="coding-new-title" />
        </label>
        <div className="cn-row">
          <label className="cn-field">
            <span className="label">{t('features.coding.prop.repo')}</span>
            <input className="input" list={`${uid}-repos`} value={repo} onChange={(e) => setRepo(e.target.value)} placeholder={repoOptional ? t(intake ? 'features.coding.new.repoIntake' : 'features.coding.new.repoNone') : 'website'} maxLength={64} data-testid="coding-new-repo" />
            <datalist id={`${uid}-repos`}>
              {known.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          </label>
          <fieldset className="cn-field cn-prio">
            <legend className="label">{t('features.coding.prop.priority')}</legend>
            <div className="cn-seg" role="radiogroup">
              {(['high', 'medium', 'low'] as const).map((p) => (
                <button key={p} type="button" role="radio" aria-checked={priority === p} className="cn-seg__opt" onClick={() => setPriority(p)}>
                  {t(`features.coding.priority.${p}`)}
                </button>
              ))}
            </div>
          </fieldset>
        </div>
        {intake && !repo.trim() ? (
          <p className="cn-hint" data-testid="coding-new-intake">{t('features.coding.new.intakeHint')}</p>
        ) : kind !== 'coding' && !repo.trim() ? (
          <p className="cn-hint">{t('features.coding.new.docHint')}</p>
        ) : (
          !known.length && <p className="cn-hint">{t('features.coding.new.noRepos')}</p>
        )}
        <label className="cn-field">
          <span className="label">{t('features.coding.new.goal')}</span>
          <textarea className="input cn-text" rows={4} value={goal} onChange={(e) => setGoal(e.target.value)} placeholder={t('features.coding.new.goalPh')} data-testid="coding-new-goal" />
        </label>
        <label className="cn-field">
          <span className="label">{t('features.coding.page.criteria')}</span>
          <textarea className="input cn-text" rows={3} value={criteria} onChange={(e) => setCriteria(e.target.value)} placeholder={t('features.coding.new.criteriaPh')} data-testid="coding-new-criteria" />
        </label>
        {FOLLOW_UPS[kind].length > 0 && (
          <fieldset className="cn-field">
            <legend className="label">{t('features.coding.prop.followUps')}</legend>
            <div className="cn-seg" role="group">
              {FOLLOW_UPS[kind].map((k) => (
                <button key={k} type="button" aria-pressed={then.includes(k)} className="cn-seg__opt" onClick={() => setThen((v) => (v.includes(k) ? v.filter((x) => x !== k) : [...v, k]))} data-testid={`coding-new-then-${k}`}>
                  {t(`features.coding.pipe.${k}`)}
                </button>
              ))}
            </div>
            <span className="cn-hint">{t('features.coding.follow.offHint')}</span>
          </fieldset>
        )}
        {kind === 'coding' && (
          <label className="cn-field">
            <span className="label">{t('features.coding.new.branch')}</span>
            <input className="input" list={`${uid}-branches`} value={branch} onChange={(e) => setBranch(e.target.value)} placeholder={t('features.coding.new.branchPh')} maxLength={200} data-testid="coding-new-branch" />
            <datalist id={`${uid}-branches`}>
              {branches.map((b) => (
                <option key={b} value={b} />
              ))}
            </datalist>
          </label>
        )}
        <label className="cn-check">
          <input type="checkbox" checked={start} onChange={(e) => setStart(e.target.checked)} />
          <span>{t('features.coding.new.start')}</span>
        </label>
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}
