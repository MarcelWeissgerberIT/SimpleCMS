/**
 * The task panel's setup strip (before the task runs): pick the Repo from the connected worker's repos, a
 * Branch from that repo's local branches (default: a new one the worker makes), and — while the page is
 * empty — where the task itself is written (the page below: goal + acceptance criteria) with an outline to
 * fill in. No repo yet: "New repo: import a ZIP / clone…" opens the worker's setup page. Business analysis / QA
 * tasks may run without a repo (document stages only: "No repository"). ApprovalsPick: which gates the task stops
 * at (plan + review · review only · none — "just do it"). ModelPick: the model of its Claude Code stages.
 */
import { useMemo } from 'react'
import { FileText } from 'lucide-react'
import { useWorkspace } from '../../store/store'
import { useT } from '../../i18n'
import type { ID } from '../../store/types'
import { useCoding } from './state'
import { useTaskLocal } from './local'
import { ChangeReposButton } from './SetupCard'
import type { PipelineKind, ResolvedStage } from './schema'
import { claudeRuns, cleanModel } from './protocol'
import { APPROVALS, MODEL_CHOICES, approvalsOf, insertTaskOutline, knownRepos, modelLabel, pipelineModels, setTaskApprovals, setTaskBranch, setTaskModel, setTaskRepo, workerBranches } from './tasks'

export function TaskSetup({ taskId, repo, branch, described, kind = 'coding' }: { taskId: ID; repo: string | null; branch: string | null; described: boolean; kind?: PipelineKind }) {
  const t = useT()
  const worker = useCoding((s) => s.worker)
  const dbs = useWorkspace((s) => s.databases)
  const repos = useMemo(() => knownRepos(), [worker, dbs]) // eslint-disable-line react-hooks/exhaustive-deps
  const { base, list } = useMemo(() => workerBranches(repo), [worker, repo]) // eslint-disable-line react-hooks/exhaustive-deps
  const announced = !!repo && !!worker?.repos.some((r) => r.name === repo)
  const other = branch && !list.includes(branch) ? branch : null

  return (
    <div className="ctk-setup" data-testid="coding-setup">
      <div className="ctk-setup__row">
        <label className="ctk-setup__field">
          <span className="label">{t('features.coding.prop.repo')}</span>
          <select className="input" value={repo ?? ''} onChange={(e) => setTaskRepo(taskId, e.target.value || null)} data-testid="coding-setup-repo">
            <option value="">{t(kind === 'coding' ? 'features.coding.task.pickRepo' : 'features.coding.task.noRepoDoc')}</option>
            {repos.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        {kind === 'coding' && (
          <label className="ctk-setup__field">
            <span className="label">{t('features.coding.prop.branch')}</span>
            <select className="input" value={branch ?? ''} disabled={!repo} onChange={(e) => setTaskBranch(taskId, e.target.value || null)} data-testid="coding-setup-branch">
              <option value="">{t('features.coding.task.newBranch')}</option>
              {other && <option value={other}>{other}</option>}
              {list.length > 0 && (
                <optgroup label={t('features.coding.task.existing')}>
                  {list.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>
        )}
      </div>
      <p className="ctk-hint" data-testid="coding-setup-hint">
        {kind !== 'coding'
          ? t(repo ? 'features.coding.task.docRepo' : 'features.coding.task.docNoRepo', { repo: repo ?? '' })
          : !repo
            ? repos.length
              ? t('features.coding.task.needRepo')
              : t('features.coding.task.noRepos')
            : branch
              ? t('features.coding.task.reuse', { branch })
              : base
                ? t('features.coding.task.fresh', { base })
                : announced || !worker
                  ? t('features.coding.task.freshPlain')
                  : t('features.coding.task.unknownRepo', { repo })}
      </p>
      <ChangeReposButton className="btn btn--sm btn--ghost ctk-setup__import" label={t('features.coding.task.importRepo')} testId="coding-setup-import" />
      {!described && (
        <div className="ctk-box ctk-box--spec" data-testid="coding-setup-spec">
          <FileText size={16} strokeWidth={1.75} aria-hidden />
          <p>
            <strong>{t('features.coding.task.specTitle')}</strong> {t('features.coding.task.specBody')}
          </p>
          <button type="button" className="btn btn--sm" onClick={() => insertTaskOutline(taskId)} data-testid="coding-setup-outline">
            {t('features.coding.task.outline')}
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * Which gates this task stops at — on this device; the last pick is the default for new tasks. Business analysis
 * / QA (no plan stage): wait at every approval, or none ("review" works like "all" there).
 */
export function ApprovalsPick({ taskId, kind = 'coding' }: { taskId: ID; kind?: PipelineKind }) {
  const t = useT()
  const stored = approvalsOf(useTaskLocal(taskId))
  if (kind !== 'coding') {
    const level = stored === 'none' ? 'none' : 'all'
    return (
      <div className="ctk-appr" data-testid="coding-approvals">
        <label className="ctk-appr__field">
          <span className="label">{t('features.coding.approvals.label')}</span>
          <select className="input" value={level} onChange={(e) => void setTaskApprovals(taskId, e.target.value === 'none' ? 'none' : 'all')} data-testid="coding-approvals-select">
            <option value="all">{t('features.coding.approvals.doc.all')}</option>
            <option value="none">{t('features.coding.approvals.doc.none')}</option>
          </select>
        </label>
        <span className="ctk-hint">{t(`features.coding.approvals.doc.${level}Hint`)}</span>
      </div>
    )
  }
  const level = stored
  return (
    <div className="ctk-appr" data-testid="coding-approvals">
      <label className="ctk-appr__field">
        <span className="label">{t('features.coding.approvals.label')}</span>
        <select className="input" value={level} onChange={(e) => void setTaskApprovals(taskId, e.target.value as typeof level)} data-testid="coding-approvals-select">
          {APPROVALS.map((a) => (
            <option key={a} value={a}>
              {t(`features.coding.approvals.${a}`)}
            </option>
          ))}
        </select>
      </label>
      <span className="ctk-hint">{t(`features.coding.approvals.${level}Hint`)}</span>
    </div>
  )
}

/**
 * Which model this task's Claude Code stages run with — on this device (TaskLocal.model): as the pipeline says (each
 * stage's own, else the worker's default), or one model for all of them. Offers the known models and the own names
 * the pipeline uses. Only for pipelines with a stage that runs Claude Code.
 */
export function ModelPick({ taskId, pipeline }: { taskId: ID; pipeline: ResolvedStage[] }) {
  const t = useT()
  const current = cleanModel(useTaskLocal(taskId).model)
  const used = useMemo(() => pipelineModels(pipeline), [pipeline])
  if (!pipeline.some((s) => claudeRuns(s.kind))) return null
  // an own name picked before that the pipeline no longer uses stays in the list while it is the task's
  const own = current && !MODEL_CHOICES.some((c) => c.id === current) && !used.includes(current) ? [...used, current] : used
  return (
    <div className="ctk-appr" data-testid="coding-model">
      <label className="ctk-appr__field">
        <span className="label">{t('features.coding.task.model.label')}</span>
        <select className="input" value={current ?? ''} onChange={(e) => void setTaskModel(taskId, e.target.value || null)} data-testid="coding-model-select">
          <option value="">{t('features.coding.task.model.pipeline')}</option>
          {MODEL_CHOICES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
          {own.length > 0 && (
            <optgroup label={t('features.coding.task.model.used')}>
              {own.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </label>
      <span className="ctk-hint">{current ? t('features.coding.task.model.setHint', { model: modelLabel(current) }) : t('features.coding.task.model.pipelineHint')}</span>
    </div>
  )
}
