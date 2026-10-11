/**
 * The Outbox's Preflight lamp "Outbox" — registered through Preflight's dependency-free registry (the one sanctioned
 * import of features/preflight from another area; Preflight itself never imports the Outbox). Counts the open slips
 * of this device and member with THE one count (`outboxCounts`): red while one is unclear or failed. Fitted where a
 * send route exists or a slip is open. Ids: slip:<id>.
 *
 * It also hands Preflight a probe: whether a slip is still open (an agent's `send` proposal counts only while it is).
 */
import { lazy } from 'react'
import { registerLampSource, setSlipProbe, type LampReading, type QueueItem } from '../preflight/registry'
import { useWorkspace } from '../../store/store'
import { currentLang, t } from '../../i18n'
import { outboxCounts } from './counts'
import { openOutbox, openSlip } from './hooks'
import { listRoutes } from './routes'
import { getSlip, getSlips, onSlipsChanged, useOutbox } from './store'
import { withdrawSlip } from './actions'
import { localized } from '../../store/integrations'
import { OPEN_STATES, SENT_STATES } from './types'

/** the card's body: the Outbox's own seal and text (loaded with the queue, never at boot) */
const SlipCardBody = lazy(() => import('./ui/LampCard'))

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
  // the queue (§6.6): every card VON HAND "sends"; A opens the slip in the Outbox (its own cover and press — Preflight
  // never sends) and the card ends when the slip leaves the reading: sent / confirmed → by hand, withdrawn → discarded
  queue: {
    items: (): QueueItem[] =>
      openSlips().map((s) => ({
        id: `slip:${s.id}`,
        lamp: 'outbox',
        kind: 'slip',
        tag: t('features.outbox.lamp.short'),
        refs: { slipId: s.id, pageId: s.target.rowId, dbId: s.target.dbId },
        at: s.createdAt,
        hand: ['sends'],
        bulk: false,
        resolveBy: 'reading',
        title: s.title,
        keyText: s.target.key,
        detail: localized(s.route.label, currentLang()),
      })),
    actions: (item) => {
      const id = item.refs.slipId ?? ''
      return [
        { key: 'a', label: t('features.outbox.lamp.openSlip'), outcome: 'hand', hand: ['sends'], run: () => (openSlip(id), { ok: true, resolve: 'reading' }) },
        {
          key: 'd',
          label: t('features.outbox.act.withdraw'),
          outcome: 'discarded',
          run: async () => {
            const res = await withdrawSlip(id, 'person')
            if (res === 'gone') return { ok: false, error: t('features.outbox.lamp.gone'), elsewhere: true }
            if (res === 'too-late') return { ok: false, error: t('features.outbox.lamp.tooLate') }
            return { ok: true, final: 'features.outbox.lamp.final' }
          },
        },
        { key: 'o', label: t('features.outbox.lamp.openOutbox'), outcome: 'hand', run: () => (openOutbox(), { ok: true, stay: true }) },
      ]
    },
    resolved: (itemId) => {
      const s = getSlip(itemId.replace(/^slip:/, ''))
      if (!s) return null
      return SENT_STATES.includes(s.state) ? 'hand' : s.state === 'withdrawn' ? 'discarded' : null
    },
    Body: SlipCardBody,
  },
})

setSlipProbe({
  isOpen: (id) => {
    const s = getSlip(id)
    return s ? OPEN_STATES.includes(s.state) : null
  },
  subscribe: (changed) => onSlipsChanged(changed),
  open: (id) => openSlip(id),
})
