/**
 * The cloud worker in three steps (Settings → Coding worker and #/coding when this team workspace goes through the
 * team server on this device, docs/CODING.md § Cloud worker):
 *   01 Download one-worker-cloud.mjs (a pending token in the file only + this device's pairing secret) — confirmed
 *      when it replaces a cloud worker of the member (it takes over only once the new file connects); Revoke
 *   02 Start it on the computer that should work (it connects out — no port, no VPN)
 *   03 Tick the repositories there (its setup page; without a browser: the terminal, or an SSH tunnel)
 * and the live state underneath, plus the rule that tasks run only while this tab (or another of this device) is
 * open.
 */
import { useCallback, useEffect, useId, useState } from 'react'
import { Download, KeyRound } from 'lucide-react'
import { useUI } from '../../store/ui'
import { useWorkspace } from '../../store/store'
import { useCloud } from '../../cloud'
import { Led } from '../../ui/controls'
import { Modal } from '../../ui/Modal'
import { useLang, useT } from '../../i18n'
import { workspaceInfo } from '../mcp/identity'
import { cloudWorkerPort } from './protocol'
import { CLOUD_WORKER_FILE, downloadCloudWorker } from './download'
import { cloudRevoked } from './service'
import { useCoding } from './state'
import { CodeBlock } from './CodeBlock'
import { ChangeReposButton, NeedsLine, Step, type StepState } from './SetupCard'
import { workerStateText } from './stateText'
import { cloudErrorKey, deviceOf, listCloudWorkers, revokeCloudWorker, serverWorkspaceId, type CloudWorker } from './cloudWorkers'
import './coding.css'

export function CloudSetupCard({ code }: { code: string }) {
  const t = useT()
  const lang = useLang()
  const s = useCoding()
  useWorkspace((x) => x.settings.workspaceName)
  useCloud((x) => x.active)
  // a viewer runs no coding tasks: nothing to list or download (§ A says why)
  const viewer = useCloud((x) => x.role) === 'viewer'
  const ws = workspaceInfo()
  const serverId = serverWorkspaceId()
  const id = useId()
  const host = window.location.host
  const [workers, setWorkers] = useState<CloudWorker[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<'replace' | 'revoke' | null>(null)

  const reload = useCallback(async () => {
    if (!serverId || viewer) return setWorkers(null)
    try {
      setWorkers((await listCloudWorkers(serverId)).filter((w) => w.mine))
    } catch {
      setWorkers(null)
    }
  }, [serverId, viewer])
  // the list follows the link (a worker came or went, a download replaced the older one)
  useEffect(() => {
    void reload()
  }, [reload, s.relay?.online, s.relay?.token, s.relay?.registered, s.conn])

  const tokens = s.cloudPairs[ws.id]?.tokens ?? []
  const here = workers?.find((w) => tokens.includes(w.id)) ?? null
  const fresh = workers?.find((w) => w.state === 'pending' && w.id === tokens[0]) ?? null
  const port = cloudWorkerPort(ws.id)
  const other = !!workers?.length && !here
  const online = workers?.find((w) => w.online) ?? null
  const connected = s.enabled && s.conn === 'connected'
  const repos = connected ? (s.worker?.repos.length ?? 0) : 0
  const done = [!!here || connected, connected, connected && repos > 0]
  const current = done.indexOf(false)
  const state = (i: number): StepState => (done[i] ? 'done' : i === current ? 'current' : 'todo')
  const led = connected ? (repos ? 'ok' : 'on') : s.enabled && (s.conn === 'waiting' || s.conn === 'connecting') ? 'on' : 'off'
  const when = (ms: number) => new Date(ms).toLocaleString(lang === 'de' ? 'de-DE' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' })
  const device = (w: CloudWorker | null | undefined) => {
    const d = deviceOf(w?.createdFrom ?? null)
    return d ? ` · ${d}` : ''
  }

  const download = async () => {
    setConfirm(null)
    setBusy(true)
    try {
      await downloadCloudWorker()
      useUI.getState().toast({ message: t('features.coding.cloud.downloaded'), kind: 'success' })
    } catch (e) {
      useUI.getState().toast({ message: t(e instanceof Error && e.message.startsWith('HTTP') ? 'features.coding.cloud.downloadFailed' : cloudErrorKey(e)), kind: 'error' })
    } finally {
      setBusy(false)
      void reload()
    }
  }
  // a download replaces the member's cloud worker (once the new file connects): ask first
  const askDownload = () => (workers?.length ? setConfirm('replace') : void download())

  const revoke = async () => {
    setConfirm(null)
    if (!serverId || !workers?.length) return
    try {
      for (const w of workers) await revokeCloudWorker(serverId, w.id)
      cloudRevoked(ws.id)
      useUI.getState().toast({ message: t('features.coding.cloud.revoked'), kind: 'success' })
    } catch (e) {
      useUI.getState().toast({ message: t(cloudErrorKey(e)), kind: 'error' })
    } finally {
      void reload()
    }
  }

  const step1Text = other
    ? t('features.coding.cloud.step1Other', { device: device(workers?.[0]) })
    : fresh
      ? t('features.coding.cloud.step1Pending', { when: when(fresh.createdAt) })
      : here
        ? t('features.coding.cloud.step1Done', { when: when(here.createdAt), device: device(here) })
        : t('features.coding.cloud.step1Hint', { name: ws.name })
  const downloadLabel = busy ? t('features.coding.cloud.downloading') : other ? t('features.coding.cloud.downloadHere') : here ? t('features.coding.cloud.downloadAgain') : t('features.coding.cloud.download')

  return (
    <section className="cs cs--cloud" aria-labelledby={id} data-testid="coding-cloud-card">
      <header className="cw-panel__head">
        <span className="label cw-panel__code" id={id}>
          {code} — {t('features.coding.cloud.kicker')}
        </span>
        <span className="label cs-ws" title={ws.id}>
          {ws.name}
        </span>
      </header>
      <ol className="cs-steps">
        <Step
          n={1}
          state={state(0)}
          title={t('features.coding.cloud.step1')}
          action={
            <div className="cs-keys">
              <button type="button" className={here || other ? 'btn btn--sm' : 'btn btn--primary'} onClick={askDownload} disabled={busy || viewer} data-testid="coding-cloud-download">
                <Download size={14} strokeWidth={1.8} aria-hidden /> {downloadLabel}
              </button>
              {!!workers?.length && (
                <button type="button" className="btn btn--sm btn--ghost" onClick={() => setConfirm('revoke')} data-testid="coding-cloud-revoke">
                  <KeyRound size={13} strokeWidth={1.75} aria-hidden /> {t('features.coding.cloud.revoke')}
                </button>
              )}
            </div>
          }
        >
          <p className="cs-hint" data-testid="coding-cloud-step1">
            {step1Text}
          </p>
        </Step>
        <Step n={2} state={state(1)} title={t('features.coding.cloud.step2')}>
          <p className="cs-hint">{t('features.coding.cloud.step2Hint', { host })}</p>
          <CodeBlock code={`node ${CLOUD_WORKER_FILE}`} label={t('features.coding.cloud.startLabel')} testId="coding-cloud-start-command" />
          <NeedsLine />
        </Step>
        <Step n={3} state={state(2)} title={t('features.coding.cloud.step3')} action={<ChangeReposButton />}>
          <p className="cs-hint">{t('features.coding.cloud.step3Hint')}</p>
          <CodeBlock code={`node ${CLOUD_WORKER_FILE} setup --no-browser`} label={t('features.coding.cloud.setupLabel')} />
          <p className="cs-hint">{t('features.coding.cloud.step3Ssh')}</p>
          <CodeBlock code={`ssh -L ${port}:127.0.0.1:${port} <host>`} label={t('features.coding.cloud.sshLabel')} />
        </Step>
      </ol>
      <footer className="cs-live cs-live--cloud" role="status" data-testid="coding-cloud-live">
        <span className="cs-live__row">
          <span className="label cs-live__k">{t('features.coding.card.live')}</span>
          <Led state={led} />
          <span className="cs-live__v">{s.enabled ? workerStateText(t, { ...s, cloud: true }) : t(other ? 'features.coding.conn.otherDevice' : 'features.coding.card.idle')}</span>
          {online && !connected && <span className="cs-live__v cs-live__aside">· {t('features.coding.cloud.liveOnline')}</span>}
        </span>
        <span className="cs-live__note">{t('features.coding.cloud.keepTab')}</span>
        <span className="cs-live__note">{t('features.coding.cloud.longStage')}</span>
        {s.dropped > 0 && <span className="cs-live__note">{t('features.coding.cloud.dropped', { n: s.dropped })}</span>}
      </footer>
      {confirm && (
        <Modal
          open
          onClose={() => setConfirm(null)}
          label={t('features.coding.via.cloud')}
          title={t(confirm === 'revoke' ? 'features.coding.cloud.revokeTitle' : 'features.coding.cloud.replaceTitle')}
          width={460}
          footer={
            <>
              <button type="button" className="btn btn--ghost" onClick={() => setConfirm(null)}>
                {t('common.cancel')}
              </button>
              {confirm === 'revoke' ? (
                <button type="button" className="btn btn--danger" onClick={() => void revoke()} data-autofocus data-testid="coding-cloud-revoke-yes">
                  {t('features.coding.cloud.revokeAction')}
                </button>
              ) : (
                <button type="button" className="btn btn--primary" onClick={() => void download()} data-autofocus data-testid="coding-cloud-replace-yes">
                  {t('features.coding.cloud.replaceAction')}
                </button>
              )}
            </>
          }
        >
          <p className="cg-confirm">
            {confirm === 'revoke' ? t('features.coding.cloud.revokeConfirm') : t(other ? 'features.coding.cloud.replaceOther' : online ? 'features.coding.cloud.replaceOnline' : 'features.coding.cloud.replaceOffline')}
          </p>
        </Modal>
      )}
    </section>
  )
}
