/**
 * The git box of a task: branch, base, ahead / behind, pushed, uncommitted files, the branch's commits,
 * conflicts — and the person's git actions, fixed verbs the worker maps to its own commands (Commit · Push ·
 * Open PR · Update from base · Show folder; Force push and Discard are confirmed twice; Clean up only after
 * the merge). The folder's path stays on the computer: "Show folder" prints it in the worker's terminal.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowUpFromLine, FolderSearch, GitCommitHorizontal, GitMerge, GitPullRequestArrow, RefreshCw, Trash2, TriangleAlert } from 'lucide-react'
import { format } from 'date-fns'
import { useT } from '../../i18n'
import { Modal } from '../../ui/Modal'
import { useUI } from '../../store/ui'
import type { GitInfo, GitVerb } from './protocol'
import { gitTask } from './service'

type T = ReturnType<typeof useT>

function Confirm({ title, body, action, danger, onConfirm, onClose }: { title: string; body: string; action: string; danger?: boolean; onConfirm: () => void; onClose: () => void }) {
  const t = useT()
  return (
    <Modal
      open
      onClose={onClose}
      label={t('features.coding.git.confirmLabel')}
      title={title}
      width={460}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className={danger ? 'btn btn--danger' : 'btn btn--primary'} onClick={onConfirm} data-autofocus>
            {action}
          </button>
        </>
      }
    >
      <p className="cg-confirm">{body}</p>
    </Modal>
  )
}

/** A key that must be pressed twice (armed for 4 s), then a dialog asks once more. */
function ArmedKey({ label, armedLabel, icon, onConfirmed, disabled, testId }: { label: string; armedLabel: string; icon: ReactNode; onConfirmed: () => void; disabled?: boolean; testId?: string }) {
  const [armed, setArmed] = useState(false)
  const timer = useRef(0)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  return (
    <button
      type="button"
      className="btn btn--sm cg-danger"
      data-armed={armed || undefined}
      disabled={disabled}
      data-testid={testId}
      onClick={() => {
        if (!armed) {
          setArmed(true)
          timer.current = window.setTimeout(() => setArmed(false), 4000)
          return
        }
        window.clearTimeout(timer.current)
        setArmed(false)
        onConfirmed()
      }}
    >
      {icon}
      {armed ? armedLabel : label}
    </button>
  )
}

export function GitBox({ taskId, git, branch, connected, running, title }: { taskId: string; git: GitInfo | null; branch: string | null; connected: boolean; running: boolean; title: string }) {
  const t = useT()
  const [busy, setBusy] = useState<GitVerb | null>(null)
  const [commitMsg, setCommitMsg] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<'force-push' | 'discard' | null>(null)

  const run = async (verb: GitVerb, message?: string) => {
    setBusy(verb)
    try {
      const res = await gitTask(taskId, verb, message)
      useUI.getState().toast({ message: res.message || t('features.coding.git.done'), kind: 'success', ...(res.url ? { action: { label: t('features.coding.git.openLink'), run: () => window.open(res.url, '_blank', 'noopener') } } : {}) })
    } catch (e) {
      useUI.getState().toast({ message: e instanceof Error ? e.message : String(e), kind: 'error', timeout: 8000 })
    } finally {
      setBusy(null)
    }
  }

  const off = !connected || running || !!busy || !branch
  const why = !connected ? t('features.coding.git.offline') : running ? t('features.coding.git.running') : !branch ? t('features.coding.git.noBranch') : null
  return (
    <div className="cg" data-testid="coding-git">
      {git ? (
        <>
          <dl className="cg-ro">
            <Cell t={t} k="branch" v={<code title={git.branch}>{git.branch}</code>} />
            <Cell t={t} k="base" v={<code>{git.base}</code>} />
            <Cell t={t} k="aheadBehind" v={`↑${git.ahead} ↓${git.behind}`} />
            <Cell t={t} k="remote" v={git.pushed ? (git.unpushed ? t('features.coding.git.unpushed', { n: git.unpushed }) : t('features.coding.git.pushed')) : t('features.coding.git.notPushed')} />
            <Cell t={t} k="dirty" v={String(git.dirty)} />
            <Cell t={t} k="owner" v={git.created ? t('features.coding.git.ownBranch') : t('features.coding.git.yourBranch')} />
          </dl>
          {git.conflicts.length > 0 && (
            <div className="cg-conflicts" role="alert">
              <TriangleAlert size={14} strokeWidth={1.75} aria-hidden />
              <div>
                <strong>{t(git.conflicts.length === 1 ? 'features.coding.git.conflicts.one' : 'features.coding.git.conflicts.other', { n: git.conflicts.length })}</strong>
                <ul>
                  {git.conflicts.map((c) => (
                    <li key={c}>
                      <code>{c}</code>
                    </li>
                  ))}
                </ul>
                <p>{t('features.coding.git.conflictsHint')}</p>
              </div>
            </div>
          )}
          {git.commits.length > 0 && (
            <ol className="cg-commits" aria-label={t('features.coding.git.commits')}>
              {git.commits.map((c) => (
                <li key={c.sha}>
                  <code>{c.sha.slice(0, 7)}</code>
                  <span className="cg-subject">{c.subject}</span>
                  <span className="cg-meta">
                    {c.author} · {format(c.at, 'dd.MM. HH:mm')}
                  </span>
                </li>
              ))}
            </ol>
          )}
          <p className="cg-at label">{t('features.coding.git.at', { time: format(git.at, 'HH:mm:ss') })}</p>
        </>
      ) : (
        <p className="ctk-empty">{branch ? t('features.coding.git.unknown') : t('features.coding.git.noBranchYet')}</p>
      )}

      {commitMsg !== null && (
        <form
          className="cg-commit"
          onSubmit={(e) => {
            e.preventDefault()
            const msg = commitMsg.trim()
            setCommitMsg(null)
            void run('commit', msg || title)
          }}
        >
          <label className="label" htmlFor={`cg-msg-${taskId}`}>
            {t('features.coding.git.message')}
          </label>
          <input id={`cg-msg-${taskId}`} className="input" value={commitMsg} onChange={(e) => setCommitMsg(e.target.value)} autoFocus maxLength={200} />
          <button type="submit" className="btn btn--sm btn--primary">
            {t('features.coding.git.commit')}
          </button>
          <button type="button" className="btn btn--sm btn--ghost" onClick={() => setCommitMsg(null)}>
            {t('common.cancel')}
          </button>
        </form>
      )}

      <div className="cg-keys" role="group" aria-label={t('features.coding.git.actions')}>
        <button type="button" className="btn btn--sm" disabled={!connected || !!busy || !branch} onClick={() => void run('refresh')}>
          <RefreshCw size={13} strokeWidth={1.75} aria-hidden />
          {t('features.coding.git.refresh')}
        </button>
        <button type="button" className="btn btn--sm" disabled={off || !git?.dirty} onClick={() => setCommitMsg(title)}>
          <GitCommitHorizontal size={13} strokeWidth={1.75} aria-hidden />
          {t('features.coding.git.commit')}
        </button>
        <button type="button" className="btn btn--sm" disabled={off} onClick={() => void run('push')}>
          <ArrowUpFromLine size={13} strokeWidth={1.75} aria-hidden />
          {t('features.coding.git.push')}
        </button>
        <button type="button" className="btn btn--sm" disabled={off} onClick={() => void run('pr')}>
          <GitPullRequestArrow size={13} strokeWidth={1.75} aria-hidden />
          {t('features.coding.git.pr')}
        </button>
        <button type="button" className="btn btn--sm" disabled={off} onClick={() => void run('update-base')}>
          <GitMerge size={13} strokeWidth={1.75} aria-hidden />
          {t('features.coding.git.updateBase')}
        </button>
        <button type="button" className="btn btn--sm" disabled={!connected || !!busy || !branch} onClick={() => void run('reveal')}>
          <FolderSearch size={13} strokeWidth={1.75} aria-hidden />
          {t('features.coding.git.reveal')}
        </button>
      </div>
      <div className="cg-keys cg-keys--danger" role="group" aria-label={t('features.coding.git.danger')}>
        <span className="label">{t('features.coding.git.danger')}</span>
        <ArmedKey label={t('features.coding.git.forcePush')} armedLabel={t('features.coding.git.again')} icon={<ArrowUpFromLine size={13} strokeWidth={1.75} aria-hidden />} disabled={off || !git?.pushed} onConfirmed={() => setConfirm('force-push')} />
        <ArmedKey label={t('features.coding.git.discard')} armedLabel={t('features.coding.git.again')} icon={<Trash2 size={13} strokeWidth={1.75} aria-hidden />} disabled={off || !git} onConfirmed={() => setConfirm('discard')} testId="coding-discard" />
        <button type="button" className="btn btn--sm" disabled={off || !git?.merged} title={git?.merged ? undefined : t('features.coding.git.cleanupHint')} onClick={() => void run('cleanup')}>
          {t('features.coding.git.cleanup')}
        </button>
      </div>
      {why && <p className="cg-why">{why}</p>}
      {busy && (
        <p className="cg-why" role="status">
          {t('features.coding.git.busy', { verb: t(`features.coding.git.verb.${busy}`) })}
        </p>
      )}

      {confirm === 'force-push' && (
        <Confirm
          title={t('features.coding.git.forceTitle', { branch: branch ?? '' })}
          body={t('features.coding.git.forceBody')}
          action={t('features.coding.git.forcePush')}
          danger
          onClose={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null)
            void run('force-push')
          }}
        />
      )}
      {confirm === 'discard' && (
        <Confirm
          title={t('features.coding.git.discardTitle', { branch: branch ?? '' })}
          body={git?.created ? t('features.coding.git.discardBodyOwn') : t('features.coding.git.discardBodyReused')}
          action={t('features.coding.git.discard')}
          danger
          onClose={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null)
            void run('discard')
          }}
        />
      )}
    </div>
  )
}

function Cell({ t, k, v }: { t: T; k: string; v: ReactNode }) {
  return (
    <div className="cg-ro__cell">
      <dt className="label">{t(`features.coding.git.ro.${k}`)}</dt>
      <dd>{v}</dd>
    </div>
  )
}
