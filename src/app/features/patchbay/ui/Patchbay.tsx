/**
 * #/patchbay — the page (a lazy chunk, route.tsx). B1: the frame and a placeholder — the head as the mock has it, a
 * readout of the wiring inventory (inventory.ts: what Workspace › Automation counts) and one plate saying what will be
 * drawn here. B6 replaces the body with the rack (Rack, Readout, Legend …); `m` / `f` / `setup` are taken from B6 / B8
 * / B12 on.
 */
import { useEffect, useMemo, useRef } from 'react'
import { List } from 'lucide-react'
import { useT } from '../../../i18n'
import { useWorkspace } from '../../../store/store'
import { navigate } from '../../../lib/router'
import { resolveAssetUrl } from '../../../lib/files'
import { focusIsNowhere } from '../../../ui/focus'
import { Screws } from '../../../ui/controls'
import { wiringCount, wiringInventory } from '../inventory'
import { WIRING_READERS } from '../readers'
import type { PatchbayRouteProps } from '../route'
import './placeholder.css'

export default function Patchbay(props: PatchbayRouteProps) {
  const t = useT()
  const h1 = useRef<HTMLHeadingElement>(null)

  // the keyboard lands on the title — only when nobody has it (⌘K, a link, a lamp left it nowhere)
  useEffect(() => {
    let id = requestAnimationFrame(() => {
      id = requestAnimationFrame(() => {
        if (focusIsNowhere()) h1.current?.focus({ preventScroll: true })
      })
    })
    return () => cancelAnimationFrame(id)
  }, [])

  const pages = useWorkspace((s) => s.pages)
  const databases = useWorkspace((s) => s.databases)
  const agents = useWorkspace((s) => s.agents)
  const scripts = useWorkspace((s) => s.scripts)
  const inv = useMemo(() => wiringInventory({ pages, databases, agents, scripts }, WIRING_READERS), [pages, databases, agents, scripts])
  const n = wiringCount(inv)

  const cells: Array<[string, number]> = [
    ['agents', inv.agents.length],
    ['scripts', inv.scripts.length],
    ['automations', inv.automations.length],
    ['commands', inv.commands.length],
    ['repeating', inv.repeating.length],
    ['databases', inv.databases.length],
  ]

  return (
    <div className="pbx" data-testid="patchbay-page">
      <header className="pbx__head">
        <img className="pbx__icon" src={resolveAssetUrl('assets/icons/automation.webp')} alt="" />
        <h1 className="display pbx__title" ref={h1} tabIndex={-1}>
          {t('features.patchbay.title')}
        </h1>
        <span className="label pbx__sub">{t('features.patchbay.sub')}</span>
        <span className="pbx__sp" />
        <button type="button" className="btn btn--ghost pbx__list" title={t('features.patchbay.asListTitle')} onClick={() => navigate({ name: 'workspace', section: 'automation' })} data-testid="patchbay-as-list">
          <List size={14} strokeWidth={1.7} aria-hidden />
          {t('features.patchbay.asList')}
        </button>
      </header>

      <div className="pbx-ro" role="group" aria-label={t('features.patchbay.ro.aria')} data-testid="patchbay-readout">
        {cells.map(([k, v]) => (
          <span key={k} className="pbx-ro__cell" data-cell={k}>
            <span className="label">{t(`features.patchbay.ro.${k}`)}</span>
            <span className="pbx-ro__val" data-testid={`patchbay-ro-${k}`}>
              {v}
            </span>
          </span>
        ))}
      </div>

      <section className="pbx__plate screw-plate" aria-labelledby="pbx-wiring">
        <Screws seed="patchbay" />
        <h2 className="label pbx__plate-label" id="pbx-wiring">
          {t('features.patchbay.wiring.label')}
        </h2>
        <p className="pbx__plate-text">{t('features.patchbay.wiring.text')}</p>
        <p className="pbx__plate-count" data-testid="patchbay-count">
          {n ? t(n === 1 ? 'features.patchbay.wiring.parts.one' : 'features.patchbay.wiring.parts', { n }) : t('features.patchbay.wiring.none')}
        </p>
      </section>
    </div>
  )
}
