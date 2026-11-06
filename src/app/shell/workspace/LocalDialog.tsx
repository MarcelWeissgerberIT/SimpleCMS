import './workspace.css'
import { useState } from 'react'
import { useT } from '../../i18n'
import { Modal } from '../../ui/Modal'
import { makeLocalWorkspace, parseWorkspacePackage, type WorkspacePackage } from '../../features'
import { switchWorkspace } from '../../cloud'
import { cleanWorkspaceName, workspaceNameProblem } from '../lib/workspaceName'
import { closeCloudDialog } from '../cloud/state'

export function LocalWorkspaceDialog() {
  const t = useT()
  const [name, setName] = useState('')
  const [packet, setPacket] = useState<WorkspacePackage>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const load = async (file?: File) => {
    if (!file) return
    setBusy(true)
    try {
      if (file.size > 200 * 1024 * 1024) throw new Error(t('shell.locals.tooLarge'))
      const parsed = parseWorkspacePackage(await file.text())
      if (!parsed) throw new Error(t('shell.locals.invalid'))
      setPacket(parsed)
      setName(parsed.backup.workspace.settings.workspaceName || '')
      setError('')
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); setPacket(undefined) } finally { setBusy(false) }
  }
  const submit = async () => {
    const clean = cleanWorkspaceName(name)
    if (workspaceNameProblem(clean)) { setError(t('shell.locals.nameError')); return }
    setBusy(true)
    try {
      const id = await makeLocalWorkspace(clean, packet)
      closeCloudDialog()
      switchWorkspace({ kind: 'local', id })
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); setBusy(false) }
  }
  return <Modal open title={t('shell.locals.new')} label="§ WS" onClose={() => !busy && closeCloudDialog()} width={560} footer={<><button type="button" className="btn btn--ghost" disabled={busy} onClick={closeCloudDialog}>{t('common.cancel')}</button><button type="submit" form="new-local-workspace" className="btn btn--primary" disabled={busy}>{t(busy ? 'shell.locals.creating' : 'shell.locals.create')}</button></>}>
    <form id="new-local-workspace" className="local-workspace-form" onSubmit={e => { e.preventDefault(); void submit() }}>
      <p>{t('shell.locals.lead')}</p>
      <label>{t('shell.locals.name')}<input className="input" value={name} maxLength={60} autoFocus disabled={busy} onChange={e => setName(e.target.value)} /></label>
      <label>{t('shell.locals.import')}<input type="file" accept=".json,.one-workspace" disabled={busy} onChange={e => void load(e.target.files?.[0])} /></label>
      {packet && <p className="label">{t('shell.locals.loaded', { n: Object.keys(packet.backup.workspace.pages).length })}</p>}
      <p className="muted">{t('shell.locals.private')}</p>
      {error && <p role="alert">{error}</p>}
    </form>
  </Modal>
}
