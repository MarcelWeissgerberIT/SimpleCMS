/**
 * The Outbox's Preflight lamp "Outbox" — registered through Preflight's dependency-free registry (the one sanctioned
 * import of features/preflight from another area; Preflight itself never imports the Outbox). Counts the open slips
 * of this device and member with THE one count (`outboxCounts`): red while one is unclear or failed. Fitted where a
 * send route exists or a slip is open. Ids: slip:<id>.
 *
 * It also hands Preflight a probe: whether a slip is still open (an agent's `send` proposal counts only while it is).
 */
import { registerLampSource, setSlipProbe, type LampReading } from '../preflight/registry'
import { useWorkspace } from '../../store/store'
import { t } from '../../i18n'
import { outboxCounts } from './counts'
import { openOutbox } from './hooks'
import { listRoutes } from './routes'
import { getSlip, getSlips, onSlipsChanged, useOutbox } from './store'
import { OPEN_STATES } from './types'

function openSlips() {
  return getSlips().filter((s) => OPEN_STATES.includes(s.state))
}

registerLampSource({
  id: 'outbox',
  order: 85,
  legend: () => t('features.outbox.lamp.legend'),
  short: () => t('features.outbox.lamp.short'),
  rule: () => t('features.outbox.lamp.rule'),
  thresholds: { amber: 1, red: null },
  fitted: () => listRoutes().length > 0 || openSlips().length > 0,
  subscribe: (changed) => {
    const a = onSlipsChanged(changed)
    const b = useWorkspace.subscribe((s, p) => {
      if (s.settings.mcpServers !== p.settings.mcpServers || s.integrations !== p.integrations) changed()
    })
    const c = useOutbox.subscribe((s, p) => {
      if (s.scope !== p.scope || s.loaded !== p.loaded) changed()
    })
    return () => {
      a()
      b()
      c()
    }
  },
  read(): LampReading {
    const open = openSlips()
    const c = outboxCounts(open)
    const red = c.unclear > 0 || c.failed > 0
    const second = c.unclear ? t('features.outbox.lamp.second.unclear', { n: c.unclear }) : c.failed ? t('features.outbox.lamp.second.failed', { n: c.failed }) : c.open ? t('features.outbox.lamp.second.ready', { n: c.open }) : ''
    return { state: 'ok', count: c.open, ids: open.map((s) => `slip:${s.id}`), second, ...(red ? { level: 'red' as const } : {}) }
  },
  open: () => openOutbox(),
})

setSlipProbe({
  isOpen: (id) => {
    const s = getSlip(id)
    return s ? OPEN_STATES.includes(s.state) : null
  },
  subscribe: (changed) => onSlipsChanged(changed),
})
