/**
 * The page head (plan §3.3, §6 U14): the automation icon, h1 "Patchbay" / "Schaltplan", the label "WHAT RUNS BY
 * ITSELF", and on the right — As list (ghost) · All databases ▾ (the filter) · Picture · zoom · the dashed "Drop a
 * profile here" chip. The keys never wrap and the h1 never shrinks for them: when they do not fit they collapse into a
 * "⋯" menu — measured, never guessed from the width (a German head needs more room than an English one):
 *   full: every key · menu: the filter stays, the rest goes into ⋯ · tight: ⋯ alone (the filter opens from it too).
 * The drop chip (B12 brings the drop and the file picker) opens Workspace › Integrations meanwhile; viewers never see
 * it. The Patching switch (P4) joins in B16.
 */
import { forwardRef, useLayoutEffect, useRef, useState, type MouseEvent } from 'react'
import { Ellipsis, FileJson, List, ListFilter, Maximize2 } from 'lucide-react'
import { useLang } from '../../../i18n'
import { resolveAssetUrl } from '../../../lib/files'
import { Menu, useMenu, type MenuEntry } from '../../../ui/Menu'
import type { Translate } from '@/shared/i18n'
import type { FilterPreset, ModelInput } from '../types'
import { FilterKey, FilterPanel, filterLabel } from './Filter'

const P = 'features.patchbay'
const TIERS = ['full', 'menu', 'tight'] as const
type Tier = (typeof TIERS)[number]

export interface HeadKeys {
  asList: () => void
  picture: ((from: HTMLElement | null) => void) | null
  drop: (() => void) | null
}

export const Header = forwardRef<HTMLHeadingElement, { t: Translate; input: ModelInput | null; filter: FilterPreset | null; profiles: string[]; hasFuses: boolean; keys: HeadKeys; width: number }>(function Header({ t, input, filter, profiles, hasFuses, keys, width }, h1) {
  const lang = useLang()
  const row = useRef<HTMLDivElement>(null)
  const more = useMenu()
  const [tier, setTier] = useState<Tier>('full')
  const [filterAt, setFilterAt] = useState<HTMLElement | null>(null)
  const moreBtn = useRef<HTMLButtonElement>(null)

  // another width or language: the widest head that fits is looked for again, before the frame is painted
  useLayoutEffect(() => setTier('full'), [width, lang, !!keys.drop, !!keys.picture])
  useLayoutEffect(() => {
    const el = row.current
    if (!el || el.scrollWidth <= el.clientWidth + 1) return
    const i = TIERS.indexOf(tier)
    if (i < TIERS.length - 1) setTier(TIERS[i + 1])
  })

  const entries: MenuEntry[] = [
    { label: t(`${P}.asList`), icon: <List size={14} />, onSelect: keys.asList },
    ...(tier === 'tight' && input ? [{ label: filterLabel(t, filter, input), icon: <ListFilter size={14} />, onSelect: () => setFilterAt(moreBtn.current) }] : []),
    ...(keys.picture ? [{ label: t(`${P}.picture`), icon: <Maximize2 size={14} />, onSelect: () => keys.picture!(moreBtn.current) }] : []),
    ...(keys.drop ? [{ label: t(`${P}.drop`), icon: <FileJson size={14} />, onSelect: keys.drop }] : []),
  ]

  return (
    <div className="pb-head" ref={row} data-tier={tier}>
      <img className="pb-head__icon" src={resolveAssetUrl('assets/icons/automation.webp')} alt="" />
      <h1 className="display pb-title" ref={h1} tabIndex={-1}>
        {t(`${P}.title`)}
      </h1>
      <span className="label pb-head__sub">{t(`${P}.sub`)}</span>
      <span className="pb-head__sp" />
      {tier === 'full' && (
        <button type="button" className="btn btn--ghost pb-key" title={t(`${P}.asListTitle`)} onClick={keys.asList} data-testid="patchbay-as-list">
          <List size={14} strokeWidth={1.7} aria-hidden="true" />
          {t(`${P}.asList`)}
        </button>
      )}
      {tier !== 'tight' && input && <FilterKey t={t} input={input} filter={filter} open={!!filterAt} onOpen={(el) => setFilterAt(filterAt ? null : el)} />}
      {tier === 'full' && keys.picture && (
        <button type="button" className="btn pb-key" title={t(`${P}.pictureTitle`)} onClick={(e) => keys.picture!(e.currentTarget)} data-testid="pb-picture">
          <Maximize2 size={14} strokeWidth={1.7} aria-hidden="true" />
          {t(`${P}.picture`)}
        </button>
      )}
      {tier === 'full' && keys.drop && (
        <button type="button" className="pb-drop" title={t(`${P}.dropTitle`)} onClick={keys.drop} data-testid="pb-drop">
          <FileJson size={14} strokeWidth={1.7} aria-hidden="true" />
          {t(`${P}.drop`)}
        </button>
      )}
      {tier !== 'full' && <MoreKey ref={moreBtn} label={t(`${P}.more`)} onClick={more.toggle} open={more.open} />}
      <Menu {...more.props} entries={entries} placement="bottom-end" width={240} />
      {input && <FilterPanel t={t} input={input} filter={filter} profiles={profiles} hasFuses={hasFuses} anchor={filterAt} onClose={() => setFilterAt(null)} />}
    </div>
  )
})

const MoreKey = forwardRef<HTMLButtonElement, { label: string; open: boolean; onClick: (e: MouseEvent) => void }>(function MoreKey({ label, open, onClick }, ref) {
  return (
    <button ref={ref} type="button" className="btn btn--ghost pb-key pb-key--more" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} onClick={onClick} data-testid="pb-more">
      <Ellipsis size={16} strokeWidth={1.7} aria-hidden="true" />
    </button>
  )
})

