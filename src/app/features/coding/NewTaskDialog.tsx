/**
 * New coding task: title, repo (the names the worker announced and those already in the database), goal,
 * acceptance criteria (one per line), priority, an existing branch to reuse (optional), and whether the
 * worker may start right away (the first automatic queue — "Ready") or it waits in the backlog.
 */
import { useId, useMemo, useState } from 'react'
import { Modal } from '../../ui/Modal'
import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import { useT } from '../../i18n'
import { useCoding } from './state'
import { codingDbId, codingProps } from './schema'
import { createTask, type NewTask } from './tasks'

export function NewTaskDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const t = useT()
  const uid = useId()
  const worker = useCoding((s) => s.worker)
  const dbs = useWorkspace((s) => s.databases)
  const known = useMemo(() => {
    const names = new Set((worker?.repos ?? []).map((r) => r.name))
    const dbId = codingDbId()
    const db = dbId ? dbs[dbId] : undefined
    if (db) {
      const props = codingProps(db)
      for (const o of db.properties.find((p) => p.id === props.repo)?.options ?? []) names.add(o.name)
    }
    return [...names]
  }, [worker, dbs])
  const [title, setTitle] = useState('')
  const [repo, setRepo] = useState(known[0] ?? '')
  const [goal, setGoal] = useState('')
  const [criteria, setCriteria] = useState('')
  const [priority, setPriority] = useState<NewTask['priority']>('medium')
  const [branch, setBranch] = useState('')
  const [start, setStart] = useState(true)
  const [saving, setSaving] = useState(false)
  const ok = title.trim().length > 0 && repo.trim().length > 0 && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(repo.trim()) && (!branch.trim() || /^[A-Za-z0-9._/-]{1,200}$/.test(branch.trim()))

  const submit = async () => {
    if (!ok || saving) return
    setSaving(true)
    try {
      const id = await createTask({ title, repo: repo.trim(), goal, criteria: criteria.split('\n'), priority, branch, start })
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
      label="§ CD"
      title={t('features.coding.new.title')}
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
            <input className="input" list={`${uid}-repos`} value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="website" maxLength={64} data-testid="coding-new-repo" />
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
        {!known.length && <p className="cn-hint">{t('features.coding.new.noRepos')}</p>}
        <label className="cn-field">
          <span className="label">{t('features.coding.new.goal')}</span>
          <textarea className="input cn-text" rows={4} value={goal} onChange={(e) => setGoal(e.target.value)} placeholder={t('features.coding.new.goalPh')} data-testid="coding-new-goal" />
        </label>
        <label className="cn-field">
          <span className="label">{t('features.coding.page.criteria')}</span>
          <textarea className="input cn-text" rows={3} value={criteria} onChange={(e) => setCriteria(e.target.value)} placeholder={t('features.coding.new.criteriaPh')} data-testid="coding-new-criteria" />
        </label>
        <label className="cn-field">
          <span className="label">{t('features.coding.new.branch')}</span>
          <input className="input" value={branch} onChange={(e) => setBranch(e.target.value)} placeholder={t('features.coding.new.branchPh')} maxLength={200} />
        </label>
        <label className="cn-check">
          <input type="checkbox" checked={start} onChange={(e) => setStart(e.target.checked)} />
          <span>{t('features.coding.new.start')}</span>
        </label>
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}
