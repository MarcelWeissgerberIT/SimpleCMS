import { useEffect, useState } from 'react'
import { useT } from '../../i18n'
import { workspaceInfo } from '../mcp/identity'
import { useCoding } from './state'
import { reconnect } from './service'
import { OsSwitch, StartBlock } from './StartBlock'
import { installedStartLines, selectedInstallLines } from './startLines'
import { CLOUD_WORKER_FILE, WORKER_FILE, startLines } from './download'

/** Reconnecting never downloads software or rotates a pairing. Offline users can start an
 * existing installation, or select their already downloaded file for the one-time install. */
export function WorkerRecovery({ cloud = false, firstInstall = false }: { cloud?: boolean; firstInstall?: boolean }) {
  const t = useT()
  const [file, setFile] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const [alreadyInstalled, setAlreadyInstalled] = useState(false)
  const ws = workspaceInfo()
  useEffect(() => { setFile(null); setError(false); setAlreadyInstalled(false) }, [ws.id, cloud])
  const install = firstInstall && !alreadyInstalled
  const select = async (chosen: File | undefined) => {
    setFile(null); setError(false)
    if (!chosen) return
    try {
      selectedInstallLines(chosen.name, 'posix')
      if (chosen.size > 16 * 1024 * 1024) throw new Error('size')
      const head = await chosen.slice(0, 16000).text()
      const raw = /^globalThis\.ONE_WORKER_PRESET\s*=\s*(.+?)\s*;?\s*$/m.exec(head)?.[1]
      const preset = raw ? JSON.parse(raw) : null
      if (workspaceInfo().id !== ws.id) return
      if (!preset || preset.workspace !== ws.id || preset.origin !== window.location.origin || !!preset.cloud !== cloud) throw new Error('workspace')
      if (!cloud && preset.pair !== useCoding.getState().pairs[ws.id]?.secret) throw new Error('pair')
      setFile(chosen.name)
    } catch { setError(true) }
  }
  return <section className="cw-managed" data-testid="coding-worker-recovery">
    <p>{t(install ? 'features.coding.recovery.first' : 'features.coding.recovery.hint')}</p>
    <OsSwitch />
    {install ? <>
      <StartBlock make={os => [startLines(cloud ? CLOUD_WORKER_FILE : WORKER_FILE, { os, args: ['install'] }), installedStartLines(cloud ? ws.id : null, os)]} label={t('features.coding.recovery.firstLabel')} testId="coding-first-install" />
      <button type="button" className="btn btn--sm" onClick={() => setAlreadyInstalled(true)}>{t('features.coding.recovery.haveInstall')}</button>
    </> : <StartBlock make={os => [installedStartLines(cloud ? ws.id : null, os)]} label={t('features.coding.managed.starter')} testId="coding-recovery-start" />}
    <button type="button" className="btn btn--primary btn--sm" onClick={() => reconnect()} data-testid="coding-recovery-retry">{t('features.coding.recovery.retry')}</button>
    <details>
      <summary>{t('features.coding.recovery.install')}</summary>
      <p>{t('features.coding.recovery.chooseHint')}</p>
      <label>{t('features.coding.recovery.choose')}<input style={{ display: 'block', maxWidth: '100%' }} type="file" accept=".mjs" onChange={e => void select(e.currentTarget.files?.[0])} data-testid="coding-recovery-file" /></label>
      {error && <p role="alert">{t('features.coding.recovery.wrongFile')}</p>}
      {file && <><p>{file}</p><StartBlock make={os => [selectedInstallLines(file, os), installedStartLines(cloud ? ws.id : null, os)]} label={t('features.coding.recovery.install')} testId="coding-selected-install" /></>}
    </details>
  </section>
}
