/**
 * Orders B10 — the work orders' setup band "§ PRÜFAUFTRÄGE" (spec §4): the six lamps of setup/orders.ts on the
 * Patchbay, above the rack — shown while a work-orders database exists, or when Settings › Coding worker opened the
 * page for it (`#/patchbay?orders=1`). The lamps are the setup lamps' own (Lamps.tsx: an `<ol>`, the state in words,
 * one primary key on the lamp worked on); 05 KONTEXT is OPTIONAL — drawn dim, green while no server is picked, never red.
 * The band reads only: each key opens its area's own step (setup/act.ts).
 */
import { useMemo, useRef } from 'react'
import type { Translate } from '@/shared/i18n'
import { useWorkspace } from '../../../store/store'
import { HelpLink } from '../../../help'
import { startedOrderCount } from '../../coding'
import type { ModelInput } from '../types'
import { ORDERS_BAND, ordersBandFacts, ordersLamps } from '../setup/orders'
import { Lamps, useVertical } from './Lamps'

const P = 'features.patchbay'

export function OrdersBand({ input, t, lang }: { input: ModelInput; t: Translate; lang: string }) {
  const chains = useWorkspace((s) => startedOrderCount(s))
  const set = useMemo(() => ordersLamps(ordersBandFacts(input, chains)), [input, chains])
  const box = useRef<HTMLElement>(null)
  const vertical = useVertical(box)
  return (
    <section className="pb-orders" ref={box} aria-labelledby="pb-orders-h" data-testid="pb-orders-band">
      <header className="pb-orders__head">
        <h2 id="pb-orders-h" className="label pb-orders__h">
          {t(`${P}.orders.head`)}
        </h2>
        <span className="label pb-orders__count">{t(`${P}.orders.count`, { n: set.done, m: set.lamps.length })}</span>
        <HelpLink id="workorders" topic={t(`${P}.orders.head`)} className="pb-orders__help" />
      </header>
      <Lamps set={set} profileId={ORDERS_BAND} t={t} lang={lang} vertical={vertical} />
    </section>
  )
}
