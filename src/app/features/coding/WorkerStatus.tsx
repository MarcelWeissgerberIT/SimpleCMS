/**
 * Status bar cell "WORKER": shown while the coding worker is switched on for this device. LED: green =
 * connected and idle, signal = a task runs (or still connecting), off = no worker. Opens #/coding.
 */
import { Led } from '../../ui/controls'
import { useT } from '../../i18n'
import { navigate } from '../../lib/router'
import { useCoding } from './state'
import { workerStateText } from './stateText'
import './coding.css'

export function CodingStatusCell() {
  const t = useT()
  const s = useCoding()
  if (!s.enabled) return null
  const connected = s.conn === 'connected'
  const text = connected && s.busy.length ? t('features.coding.status.busy', { n: s.busy.length }) : t('features.coding.status.worker')
  return (
    <button type="button" className="status__cell cw-status" data-busy={s.busy.length > 0 || undefined} onClick={() => navigate({ name: 'coding' })} title={workerStateText(t, s)} aria-label={`${text} — ${workerStateText(t, s)}`} data-testid="coding-status">
      <Led state={connected ? (s.busy.length ? 'on' : 'ok') : 'off'} />
      {text}
    </button>
  )
}
