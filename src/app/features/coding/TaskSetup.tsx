/**
 * The task panel's setup strip (before the task runs): pick the Repo from the connected worker's repos, a
 * Branch from that repo's local branches (default: a new one the worker makes), and — while the page is
 * empty — where the task itself is written (the page below: goal + acceptance criteria) with an outline to
 * fill in. ApprovalsPick: which gates the task stops at (plan + review · review only · none — "just do it").
 */
import { useMemo } from 'react'
import { FileText } from 'lucide-react'
import { useWorkspace } from '../../store/store'
import { useT } from '../../i18n'
import type { ID } from '../../store/types'
import { useCoding } from './state'
import { useTaskLocal } from './local'
import { APPROVALS, approvalsOf, insertTaskOutline, knownRepos, setTaskApprovals, setTaskBranch, setTaskRepo, workerBranches } from './tasks'

export function TaskSetup({ taskId, repo, branch, described }: { taskId: ID; repo: string | null; branch: string | null; described: boolean }) {
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
            <option value="">{t('features.coding.task.pickRepo')}</option>
            {repos.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
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
      </div>
      <p className="ctk-hint" data-testid="coding-setup-hint">
        {!repo
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

/** Which gates this task stops at — on this device; the last pick is the default for new tasks. */
export function ApprovalsPick({ taskId }: { taskId: ID }) {
  const t = useT()
  const level = approvalsOf(useTaskLocal(taskId))
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
