import { useEffect, useState } from 'react'
import { RefreshCw, Undo2 } from 'lucide-react'
import { useT } from '../../i18n'
import { useCoding } from './state'
import { manageWorker, type ManagedWorkerStatus } from './service'
import { OsSwitch, StartBlock } from './StartBlock'
import { installedStartLines, actualInstalledStartLines, migrationLines } from './startLines'
import { downloadWorkerInstaller, WORKER_FILE, CLOUD_WORKER_FILE } from './download'
import { workspaceInfo } from '../mcp/identity'

/** Management is a person's explicit action, never an AI tool or an automatic model-triggered update. */
export function ManagedWorker() {
  const t = useT()
  const worker = useCoding(s => s.conn === 'connected' ? s.worker : null)
  const [status, setStatus] = useState<ManagedWorkerStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  useEffect(() => {
    setStatus(null); setError(false)
    if (!worker?.managed) return
    let live = true
    const read = () => void manageWorker('status').then(s => { if (live) setStatus(s) }).catch(() => {})
    read(); const timer = window.setInterval(read, 4000)
    return () => { live = false; window.clearInterval(timer) }
  }, [worker])
  const action = async (verb: 'update' | 'rollback' | 'cancel') => {
    setBusy(true); setError(false)
    try { setStatus(await manageWorker(verb)) } catch { setError(true) } finally { setBusy(false) }
  }
  const phase = status?.phase ?? 'running'
  const waiting = ['checking', 'waiting-for-idle', 'switching', 'rolling-back'].includes(phase)
  if (!worker) return null
  if (worker.managedHost) return <section className="cw-managed" data-testid="coding-managed-host">
    <header><span className="label">{t('features.coding.managed.title')}</span><strong>v{worker.worker} · {worker.name}</strong></header>
    <p>{t('features.coding.recovery.host')}</p>
    <details><summary>{t('features.coding.managed.starter')}</summary><OsSwitch /><StartBlock make={os => [installedStartLines(null, os)]} label={t('features.coding.managed.starter')} /></details>
  </section>
  if (!worker.managed) return <section className="cw-managed" data-testid="coding-install-existing">
    <header><span className="label">{t('features.coding.managed.migrate')}</span><strong>v{worker.worker} · {worker.name}</strong></header>
    <p>{t('features.coding.managed.migrateHint')}</p>
    <button className="btn btn--sm" disabled={busy} onClick={() => { setBusy(true); setError(false); void downloadWorkerInstaller().catch(() => setError(true)).finally(() => setBusy(false)) }}>{t('features.coding.managed.installer')}</button>
    <OsSwitch /><StartBlock make={os => [migrationLines(worker.via === 'cloud' ? CLOUD_WORKER_FILE : WORKER_FILE, os)]} label={t('features.coding.managed.migrate')} />
    {error && <p role="alert">{t('features.coding.managed.error')}</p>}
  </section>
  return <section className="cw-managed" data-testid="coding-managed">
    <header><span className="label">{t('features.coding.managed.title')}</span><strong>v{status?.version ?? worker.worker} · {worker.name}</strong></header>
    <p>{t(waiting ? 'features.coding.managed.waiting' : 'features.coding.managed.ready')}</p>
    <div className="cs-keys">
      <button className="btn btn--primary btn--sm" disabled={busy || waiting} onClick={() => void action('update')} data-testid="coding-managed-update"><RefreshCw size={14} aria-hidden />{t(busy ? 'features.coding.managed.checking' : 'features.coding.managed.update')}</button>
      {waiting && <button className="btn btn--sm" disabled={busy || phase !== 'waiting-for-idle'} onClick={() => void action('cancel')}>{t('features.coding.managed.cancel')}</button>}
      {status?.previous && <button className="btn btn--sm" disabled={busy || waiting} onClick={() => void action('rollback')} data-testid="coding-managed-rollback"><Undo2 size={14} aria-hidden />{t('features.coding.managed.rollback', { version: status.previous })}</button>}
    </div>
    {(error || status?.error) && <p role="alert">{t('features.coding.managed.error')}</p>}
    <details><summary>{t('features.coding.managed.starter')}</summary><OsSwitch /><StartBlock make={os => [status?.path ? actualInstalledStartLines(status.path, os) : installedStartLines(worker.via === 'cloud' ? workspaceInfo().id : null, os)]} label={t('features.coding.managed.starter')} /></details>
  </section>
}
