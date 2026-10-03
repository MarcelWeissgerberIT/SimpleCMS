/**
 * Status bar cell next to "SAVED LOCALLY": shown while a folder or GitHub sync is set up.
 * LED + a short read-out ("SYNC · 14:05", "SYNC · 3 PENDING", "SYNC PAUSED" …); opens Settings → Sync.
 */
import { Led } from '../../ui/controls'
import { useLang, useT } from '../../i18n'
import { openSyncSettings, useSync } from './service'
import './sync.css'

export function SyncStatusCell() {
  const t = useT()
  const lang = useLang()
  const folder = useSync((s) => s.folder)
  const github = useSync((s) => s.github)
  const folderOn = folder.state !== 'off' && folder.state !== 'unsupported'
  const githubOn = github.state !== 'off'
  if (!folderOn && !githubOn) return null

  const states = [folderOn ? folder.state : null, githubOn ? github.state : null]
  const running = states.includes('running')
  const error = states.includes('error')
  const paused = folder.state === 'permission'
  const pending = githubOn ? github.pending : 0
  const last = Math.max(folder.lastAt ?? 0, github.lastAt ?? 0)
  const time = last ? new Date(last).toLocaleTimeString(lang === 'de' ? 'de-DE' : 'en-US', { hour: '2-digit', minute: '2-digit', hour12: false }) : null

  // while a run is busy the LED blinks; the read-out keeps its text (no jumping status bar on every save)
  const [state, text] = running
    ? (['running', pending > 0 ? t('features.sync.status.pending', { n: pending }) : time ? t('features.sync.status.synced', { time }) : t('features.sync.status.running')] as const)
    : error
      ? (['error', t('features.sync.status.error')] as const)
      : paused
        ? (['paused', t('features.sync.status.paused')] as const)
        : pending > 0
          ? (['pending', t('features.sync.status.pending', { n: pending })] as const)
          : (['ok', time ? t('features.sync.status.synced', { time }) : t('features.sync.status.on')] as const)

  return (
    <button type="button" className="status__cell sy-status" data-state={state} onClick={openSyncSettings} title={t('features.sync.status.title')} aria-label={`${text} — ${t('features.sync.status.title')}`}>
      <Led state={state === 'ok' ? 'ok' : state === 'error' ? 'off' : 'on'} />
      {text}
    </button>
  )
}
