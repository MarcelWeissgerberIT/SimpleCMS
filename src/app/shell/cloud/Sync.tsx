import { Eye } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useCloud, type CloudStatus } from '../../cloud'
import { Led } from '../../ui/controls'
import { Tooltip } from '../../ui/Tooltip'
import { useT } from '../../i18n'
import { cloudApi } from './api'
import { useWorkspaceTitle } from './state'

type CloudReadout = { state: Exclude<CloudStatus, 'local'>; text: string; tip: string; led: 'on' | 'ok' | 'off' }

/** The sync read-out of the active cloud workspace, or null in the local workspace. */
export function useCloudReadout(): CloudReadout | null {
  const t = useT()
  const status = useCloud((s) => (s.active.kind === 'cloud' ? s.status : 'local'))
  switch (status) {
    case 'local':
      return null
    case 'online':
      return { state: status, text: t('shell.cloud.sync.online'), tip: t('shell.cloud.sync.onlineTip'), led: 'ok' }
    case 'offline':
      return { state: status, text: t('shell.cloud.sync.offline'), tip: t('shell.cloud.sync.offlineTip'), led: 'off' }
    case 'error':
      return { state: status, text: t('shell.cloud.sync.error'), tip: t('shell.cloud.sync.errorTip'), led: 'off' }
    case 'checking':
      return { state: status, text: t('shell.cloud.sync.checking'), tip: t('shell.cloud.sync.connectingTip'), led: 'on' }
    default:
      return { state: status, text: t('shell.cloud.sync.connecting'), tip: t('shell.cloud.sync.connectingTip'), led: 'on' }
  }
}

/** Status-bar cells in a cloud workspace: sync state, VIEW ONLY, people online. */
export function CloudStatusCells({ readout }: { readout: CloudReadout }) {
  const t = useT()
  const { readOnly, others } = useCloud(
    useShallow((s) => ({ readOnly: s.readOnly, others: new Set(s.peers.filter((p) => p.userId !== s.user?.id).map((p) => p.userId)).size })),
  )
  return (
    <>
      <span className="status__cell status__save" data-cloud={readout.state} role="status" title={readout.tip}>
        <Led state={readout.led} />
        {readout.text}
      </span>
      {readOnly && <span className="status__cell status__ro">{t('shell.cloud.viewOnly')}</span>}
      {others > 0 && readout.state === 'online' && <span className="status__cell">{t(others === 1 ? 'shell.cloud.sync.peers.one' : 'shell.cloud.sync.peers', { n: others })}</span>}
    </>
  )
}

/** Topbar tag for viewers. */
export function ViewOnlyTag() {
  const t = useT()
  const readOnly = useCloud((s) => s.readOnly && s.active.kind === 'cloud')
  if (!readOnly) return null
  return (
    <Tooltip label={t('shell.cloud.viewOnlyHint')}>
      <span className="cl-viewonly" tabIndex={0} data-testid="view-only">
        <Eye size={12} strokeWidth={2} aria-hidden />
        {t('shell.cloud.viewOnly')}
      </span>
    </Tooltip>
  )
}

type Kind = 'revoked' | 'deleted' | 'session' | 'generic'

/** The core reports why syncing stopped in `error`; the close reasons of docs/CLOUD.md map to plain words. */
function kindOf(error: string | null): Kind {
  const e = (error ?? '').toLowerCase()
  if (/membership-revoked|revoked|removed|forbidden|workspace_not_found/.test(e)) return 'revoked'
  if (/workspace-deleted|deleted/.test(e)) return 'deleted'
  if (/session-ended|session|unauthenticated|signed[- ]out/.test(e)) return 'session'
  return 'generic'
}

/** Fatal cloud states as a banner over the working area, with the next action. */
export function CloudBanner() {
  const t = useT()
  const { status, error, active } = useCloud(useShallow((s) => ({ status: s.status, error: s.error, active: s.active })))
  const workspace = useWorkspaceTitle()
  if (status !== 'error' || active.kind !== 'cloud') return null
  const kind = kindOf(error)
  const title = kind === 'revoked' ? t('shell.cloud.banner.revoked', { workspace }) : kind === 'deleted' ? t('shell.cloud.banner.deleted', { workspace }) : kind === 'session' ? t('shell.cloud.banner.session') : t('shell.cloud.banner.generic')
  const hint = kind === 'revoked' ? t('shell.cloud.banner.revokedHint') : kind === 'deleted' ? t('shell.cloud.banner.deletedHint') : kind === 'session' ? t('shell.cloud.banner.sessionHint') : (error ?? '')
  const toLocal = () => cloudApi.switchWorkspace({ kind: 'local', id: 'local' })
  return (
    <div className="cl-banner" role="alert" data-kind={kind}>
      <div className="cl-banner__stripes" aria-hidden />
      <div className="cl-banner__body">
        <div className="cl-banner__text">
          <div className="label cl-banner__label">
            <Led />
            {t('shell.cloud.banner.label')}
          </div>
          <p className="cl-banner__title">{title}</p>
          {hint && <p className="cl-banner__hint">{hint}</p>}
        </div>
        <div className="cl-banner__actions">
          {kind === 'session' && (
            <button type="button" className="btn btn--ink" onClick={() => cloudApi.switchWorkspace(active)}>
              {t('shell.cloud.banner.signIn')}
            </button>
          )}
          {kind === 'generic' && (
            <button type="button" className="btn btn--ink" onClick={() => window.location.reload()}>
              {t('shell.cloud.banner.reload')}
            </button>
          )}
          <button type="button" className={`btn ${kind === 'revoked' || kind === 'deleted' ? 'btn--ink' : ''}`} onClick={toLocal}>
            {t('shell.cloud.banner.toLocal')}
          </button>
        </div>
      </div>
    </div>
  )
}
