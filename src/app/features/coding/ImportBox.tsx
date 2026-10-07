/**
 * The task panel while a task stands in an Import stage: the code it starts from — drop / pick a ZIP (sent to the
 * worker in pieces), paste a clone address, or take a repo the worker has. The worker makes a new repository in its
 * clone folder; the task takes it as its Repo and moves on (tasks.ts intakeDone).
 */
import { useId, useMemo, useRef, useState } from 'react'
import { FileArchive, GitBranch, Upload } from 'lucide-react'
import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import { useT } from '../../i18n'
import type { ID } from '../../store/types'
import { useCoding } from './state'
import { cloneForTask, sendTaskZip } from './service'
import { intakeDone, knownRepos } from './tasks'

export function ImportBox({ taskId, canAct }: { taskId: ID; canAct: boolean }) {
  const t = useT()
  const uid = useId()
  const connected = useCoding((s) => s.enabled && s.conn === 'connected')
  const worker = useCoding((s) => s.worker)
  const intake = useCoding((s) => s.intake[taskId] ?? null)
  const dbs = useWorkspace((s) => s.databases)
  const repos = useMemo(() => knownRepos(), [worker, dbs]) // eslint-disable-line react-hooks/exhaustive-deps
  const [url, setUrl] = useState('')
  const [pick, setPick] = useState('')
  const [over, setOver] = useState(false)
  const file = useRef<HTMLInputElement>(null)
  const busy = intake?.state === 'running'
  const off = !connected || !canAct || busy

  const fail = (e: unknown) => useUI.getState().toast({ message: e instanceof Error ? e.message : String(e), kind: 'error' })
  const send = (f: File | undefined | null) => {
    if (f && !off) void sendTaskZip(taskId, f).catch(fail)
  }

  return (
    <div className="cib" data-testid="coding-import" aria-busy={busy || undefined}>
      <div className="cib-head">
        <span className="label">{t('features.coding.intake.title')}</span>
        <span className="ctk-hint">{t('features.coding.intake.lead')}</span>
      </div>
      {!connected && <p className="ctk-msg">{t('features.coding.intake.offline')}</p>}

      <div
        className="cib-drop"
        data-over={over || undefined}
        data-off={off || undefined}
        onDragOver={(e) => {
          if (off) return
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          send(e.dataTransfer.files[0])
        }}
      >
        <FileArchive size={18} strokeWidth={1.6} aria-hidden />
        <span>{t('features.coding.intake.drop')}</span>
        <button type="button" className="btn btn--sm" disabled={off} onClick={() => file.current?.click()} data-testid="coding-import-zip">
          <Upload size={14} strokeWidth={1.75} aria-hidden /> {t('features.coding.intake.pick')}
        </button>
        <input
          ref={file}
          type="file"
          accept=".zip,application/zip"
          hidden
          aria-label={t('features.coding.intake.pick')}
          data-testid="coding-import-file"
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            send(f)
          }}
        />
      </div>

      <form
        className="cib-row"
        onSubmit={(e) => {
          e.preventDefault()
          if (!off && url.trim()) void cloneForTask(taskId, url).catch(fail)
        }}
      >
        <label className="label" htmlFor={`${uid}-url`}>
          {t('features.coding.intake.cloneLabel')}
        </label>
        <input id={`${uid}-url`} className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder={t('features.coding.intake.clonePh')} spellCheck={false} autoComplete="off" disabled={off} data-testid="coding-import-url" />
        <button type="submit" className="btn btn--sm" disabled={off || !url.trim()} data-testid="coding-import-clone">
          <GitBranch size={14} strokeWidth={1.75} aria-hidden /> {t('features.coding.intake.clone')}
        </button>
      </form>

      {repos.length > 0 && (
        <div className="cib-row">
          <label className="label" htmlFor={`${uid}-repo`}>
            {t('features.coding.intake.existing')}
          </label>
          <select id={`${uid}-repo`} className="input" value={pick} onChange={(e) => setPick(e.target.value)} disabled={!canAct || busy} data-testid="coding-import-repo">
            <option value="">{t('features.coding.task.pickRepo')}</option>
            {repos.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn--sm" disabled={!canAct || busy || !pick} onClick={() => void intakeDone(taskId, pick).catch(fail)} data-testid="coding-import-use">
            {t('features.coding.intake.use')}
          </button>
        </div>
      )}

      {intake && (
        <div className="cib-state" data-state={intake.state} role="status" data-testid="coding-import-state">
          {intake.state === 'failed' ? (
            <p className="cib-err">
              <strong>{t('features.coding.intake.failed')}</strong> {intake.error}
            </p>
          ) : (
            <>
              <span className="cib-label mono">{intake.label}</span>
              <span className="cib-line">{intake.state === 'done' ? t('features.coding.intake.done', { repo: intake.repo ?? '' }) : intake.line}</span>
              <span className="cib-bar" aria-hidden>
                <span className="cib-fill" data-indeterminate={intake.percent === null || undefined} ref={(el) => {
                    if (el) el.style.width = `${intake.percent ?? 30}%`
                  }} />
              </span>
            </>
          )}
        </div>
      )}
    </div>
  )
}
