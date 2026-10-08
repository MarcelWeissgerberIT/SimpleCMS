/**
 * Workspace page → Automation (admins and the owner of a team workspace): every member's cloud worker — whose,
 * online or when last seen, which browser downloaded it — and Revoke. An admin can stop a worker, never use it:
 * only the browser that downloaded it holds its key (docs/CODING.md § Cloud worker).
 */
import { useCallback, useEffect, useState } from 'react'
import { useCloud } from '../../cloud'
import { Led } from '../../ui/controls'
import { Modal } from '../../ui/Modal'
import { useUI } from '../../store/ui'
import { useLang, useT } from '../../i18n'
import { cloudErrorKey, deviceOf, listCloudWorkers, relayAvailable, revokeCloudWorker, type CloudWorker } from './cloudWorkers'
import './coding.css'

export function CloudWorkers() {
  const t = useT()
  const lang = useLang()
  const active = useCloud((x) => x.active)
  const role = useCloud((x) => x.role)
  const admin = active.kind === 'cloud' && (role === 'admin' || role === 'owner')
  const [workers, setWorkers] = useState<CloudWorker[] | null>(null)
  const [revoking, setRevoking] = useState<CloudWorker | null>(null)

  const reload = useCallback(async () => {
    if (!admin) return setWorkers(null)
    try {
      setWorkers((await relayAvailable()) ? await listCloudWorkers(active.id) : null)
    } catch {
      setWorkers(null)
    }
  }, [admin, active.id])
  useEffect(() => {
    void reload()
  }, [reload])

  if (!admin || !workers) return null
  const when = (ms: number) => new Date(ms).toLocaleString(lang === 'de' ? 'de-DE' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' })
  const who = (w: CloudWorker) => w.user.name || w.user.email

  const revoke = async (w: CloudWorker) => {
    setRevoking(null)
    try {
      await revokeCloudWorker(active.id, w.id)
      useUI.getState().toast({ message: t('features.coding.admin.revoked'), kind: 'success' })
    } catch (e) {
      useUI.getState().toast({ message: t(cloudErrorKey(e)), kind: 'error' })
    }
    void reload()
  }

  return (
    <section className="cwa" aria-labelledby="ws-coding-cloud-head" data-testid="ws-coding-cloud">
      <h3 className="label cwa-head" id="ws-coding-cloud-head">
        {t('features.coding.admin.title')} <span className="cwa-count">{workers.length}</span>
      </h3>
      {workers.length === 0 ? (
        <p className="cwa-none">{t('features.coding.admin.none')}</p>
      ) : (
        <ul className="cwa-list">
          {workers.map((w) => {
            const device = deviceOf(w.createdFrom)
            const status = w.online ? t('features.coding.admin.online') : w.state === 'pending' ? t('features.coding.admin.pending') : w.lastUsedAt ? t('features.coding.admin.lastSeen', { when: when(w.lastUsedAt) }) : t('features.coding.admin.never')
            return (
              <li key={w.id} className="cwa-item" data-testid="ws-coding-cloud-item">
                <Led state={w.online ? 'ok' : 'off'} />
                <span className="cwa-who" title={w.user.email}>
                  {who(w)}
                </span>
                <span className="cwa-meta">
                  {status}
                  {device ? ` · ${t('features.coding.admin.from', { device })}` : ''}
                </span>
                <button type="button" className="btn btn--sm btn--ghost cwa-revoke" onClick={() => setRevoking(w)} data-testid={`ws-coding-cloud-revoke-${w.id}`} aria-label={`${t('features.coding.admin.revoke')} — ${who(w)}`}>
                  {t('features.coding.admin.revoke')}
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {revoking && (
        <Modal
          open
          onClose={() => setRevoking(null)}
          label={t('features.coding.via.cloud')}
          title={t('features.coding.admin.revokeTitle')}
          width={440}
          footer={
            <>
              <button type="button" className="btn btn--ghost" onClick={() => setRevoking(null)}>
                {t('common.cancel')}
              </button>
              <button type="button" className="btn btn--danger" onClick={() => void revoke(revoking)} data-autofocus data-testid="ws-coding-cloud-revoke-yes">
                {t('features.coding.admin.revoke')}
              </button>
            </>
          }
        >
          <p className="cg-confirm">{t('features.coding.admin.revokeConfirm', { who: who(revoking) })}</p>
        </Modal>
      )}
    </section>
  )
}
