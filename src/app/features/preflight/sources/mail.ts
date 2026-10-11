/**
 * Lamp "Mail" (fitted where Gmail is set up on this device): the last sync failed → red (mail:error:<where>); the
 * interval found no valid sign-in → amber (mail:reconnect).
 */
import { t } from '../../../i18n'
import { openMailSettings, useMail } from '../../mail'
import type { LampReading, LampSourceDef } from '../registry'
import { watch } from './util'

export const mailLamp: LampSourceDef = {
  id: 'mail',
  order: 130,
  legend: () => t('features.preflight.lamp.mail.legend'),
  short: () => t('features.preflight.lamp.mail.short'),
  rule: () => t('features.preflight.lamp.mail.rule'),
  thresholds: { amber: 1, red: null },
  fitted: () => !!useMail.getState().account,
  subscribe: (changed) => watch(useMail, (s) => [s.account, s.errorAt, s.reconnect], changed),
  read(): LampReading {
    const s = useMail.getState()
    if (s.errorAt) return { state: 'ok', count: 1, ids: [`mail:error:${s.errorAt}`], level: 'red', second: t('features.preflight.lamp.mail.second.error') }
    if (s.reconnect) return { state: 'ok', count: 1, ids: ['mail:reconnect'], level: 'amber', second: t('features.preflight.lamp.mail.second.reconnect') }
    return { state: 'ok', count: 0, ids: [], second: '' }
  },
  open: () => openMailSettings(),
}
