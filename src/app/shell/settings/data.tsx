/**
 * The data parts of the settings, shared by Settings → Data (this device) and the workspace page's
 * Data / Danger zone sections (shell/workspace) — one component each, never forked:
 *  - StorageGauge: what this browser stores (navigator.storage.estimate) against its quota
 *  - BackupKeys: Export workspace (the export dialog) · Import (writers only)
 *  - ResetWorkspace: erase the local workspace on this device (asks first) — the local danger zone
 */
import { useEffect, useState } from 'react'
import { AlertTriangle, Download, Upload } from 'lucide-react'
import { useUI } from '../../store/ui'
import { useLang, useT } from '../../i18n'
import { fmtBytes } from '../lib/format'
import { requestReset } from '../lib/reset'
import { useReadOnly } from '../cloud/state'
import './settings.css'

export interface StorageEstimate {
  usage: number
  quota: number
}

/** navigator.storage.estimate(), once per mount (null: unknown / unsupported). */
export function useStorageEstimate(): StorageEstimate | null {
  const [est, setEst] = useState<StorageEstimate | null>(null)
  useEffect(() => {
    let alive = true
    navigator.storage
      ?.estimate?.()
      .then((e) => alive && setEst({ usage: e.usage ?? 0, quota: e.quota ?? 0 }))
      .catch(() => alive && setEst(null))
    return () => {
      alive = false
    }
  }, [])
  return est
}

export function StorageGauge({ est, label }: { est: StorageEstimate | null; label?: string }) {
  const t = useT()
  const lang = useLang()
  const pct = est && est.quota ? Math.min(100, (est.usage / est.quota) * 100) : 0
  return (
    <div className="gauge">
      <div className="gauge__head">
        <span className="label">{label ?? t('shell.settings.data.storage')}</span>
        <span className="gauge__val">{est ? `${fmtBytes(est.usage, lang)} / ${fmtBytes(est.quota, lang)}` : '—'}</span>
      </div>
      <div className="gauge__track" role="meter" aria-label={label ?? t('shell.settings.data.storage')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
        <div className="gauge__fill" style={{ width: `${Math.max(pct, est ? 0.6 : 0)}%` }} />
        <div className="gauge__ticks" />
      </div>
      <div className="gauge__scale">
        <span>0</span>
        <span>25</span>
        <span>50</span>
        <span>75</span>
        <span>100%</span>
      </div>
    </div>
  )
}

/** Export the whole workspace (backup, Markdown, HTML, site …) and import into it. */
export function BackupKeys({ before }: { before?: () => void }) {
  const t = useT()
  const readOnly = useReadOnly()
  const ui = useUI.getState()
  return (
    <div className="st-actions">
      <button
        type="button"
        className="btn"
        onClick={() => {
          before?.()
          ui.openModal({ type: 'export', pageId: null })
        }}
      >
        <Download size={14} />
        {t('shell.settings.data.export')}
      </button>
      {!readOnly && (
        <button
          type="button"
          className="btn"
          onClick={() => {
            before?.()
            ui.openModal({ type: 'import' })
          }}
        >
          <Upload size={14} />
          {t('shell.settings.data.import')}
        </button>
      )}
    </div>
  )
}

/** Erase the local workspace on this device and start fresh (asks first). Never in a team workspace. */
export function ResetWorkspace({ before }: { before?: () => void }) {
  const t = useT()
  return (
    <div className="danger" data-testid="reset-workspace">
      <div className="danger__stripes" aria-hidden />
      <div className="danger__text">
        <div className="label danger__label">
          <AlertTriangle size={12} /> {t('shell.settings.data.danger')}
        </div>
        <strong>{t('shell.settings.data.reset')}</strong>
        <p>{t('shell.settings.data.resetBody')}</p>
      </div>
      <button
        type="button"
        className="btn btn--danger-solid"
        onClick={() => {
          before?.()
          useUI.getState().openModal({
            type: 'confirm',
            title: t('shell.settings.data.resetConfirmTitle'),
            body: t('shell.settings.data.resetConfirmBody'),
            danger: true,
            confirmLabel: t('shell.settings.data.resetConfirm'),
            onConfirm: requestReset,
          })
        }}
      >
        {t('shell.settings.data.reset')}
      </button>
    </div>
  )
}
