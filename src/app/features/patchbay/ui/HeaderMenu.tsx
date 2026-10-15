/**
 * The page head (plan §3.3, §6 U14): the automation icon, h1 "Patchbay" / "Schaltplan", the label "WHAT RUNS BY
 * ITSELF", and on the right — As list (ghost) · All databases ▾ (the filter) · Picture · zoom · the dashed "Drop a
 * profile here" chip. The keys never wrap and the h1 never shrinks for them: when they do not fit they collapse into a
 * "⋯" menu — measured, never guessed from the width (a German head needs more room than an English one):
 *   full: every key · menu: the filter stays, the rest goes into ⋯ · tight: ⋯ alone (the filter opens from it too).
 * The drop chip (B12) opens its menu — Choose a file · Paste — or, for a team member without the rights, who can drop
 * a profile (DropFlow.tsx DropChip); it is hidden while a setup band is on and for viewers.
 *
 * B16 — the Patching switch (P4, §1.13, §6 U16): a glass rocker "Patching" / "Patchen" first on the right, off by
 * default, this device's (patching.ts). Hidden for viewers and read-only members, and on the strands view (no jacks to
 * patch there). In the tight head it is an entry of ⋯ that says its state.
 */
import { forwardRef, useLayoutEffect, useRef, useState, type MouseEvent } from 'react'
import { Cable, Ellipsis, FileJson, List, ListFilter, Maximize2 } from 'lucide-react'
import { useLang } from '../../../i18n'
import { focusLost, restoreFocus } from '../../../ui/focus'
import { resolveAssetUrl } from '../../../lib/files'
import { Menu, useMenu, type MenuEntry } from '../../../ui/Menu'
import { Switch } from '../../../ui/controls'
import type { Translate } from '@/shared/i18n'
import type { FilterPreset, ModelInput } from '../types'
import { FilterKey, FilterPanel, filterLabel } from './Filter'

const P = 'features.patchbay'
const TIERS = ['full', 'menu', 'tight'] as const
type Tier = (typeof TIERS)[number]

export interface HeadKeys {
  asList: () => void
  picture: ((from: HTMLElement | null) => void) | null
  /** the drop chip's menu, opened at the key pressed (the chip, or ⋯ when the head folded it) */
  drop: ((from: HTMLElement | null) => void) | null
  /** B16: the Patching switch (null: hidden — a viewer, a read-only member, the strands view) */
  patch: { on: boolean; set: (on: boolean) => void } | null
}

export const Header = forwardRef<HTMLHeadingElement, { t: Translate; input: ModelInput | null; filter: FilterPreset | null; profiles: string[]; hasFuses: boolean; keys: HeadKeys; width: number }>(function Header({ t, input, filter, profiles, hasFuses, keys, width }, h1) {
  const lang = useLang()
  const row = useRef<HTMLDivElement>(null)
  const more = useMenu()
  const [tier, setTier] = useState<Tier>('full')
  const [filterAt, setFilterAt] = useState<HTMLElement | null>(null)
  const moreBtn = useRef<HTMLButtonElement>(null)

  // another width or language: the widest head that fits is looked for again, before the frame is painted
  useLayoutEffect(() => setTier('full'), [width, lang, !!keys.drop, !!keys.picture, !!keys.patch])
  useLayoutEffect(() => {
    const el = row.current
    if (!el || el.scrollWidth <= el.clientWidth + 1) return
    const i = TIERS.indexOf(tier)
    if (i < TIERS.length - 1) setTier(TIERS[i + 1])
  })

  // the filter is a dialog popover (Popover gives the keyboard back only from menus): after a pick or Esc the keyboard
  // goes back to the key it was opened from ("All databases", or ⋯ in the tight head) — a press outside that put it
  // somewhere keeps it there (only a keyboard lost with the panel is given back)
  const closeFilter = () => {
    const from = filterAt
    setFilterAt(null)
    requestAnimationFrame(() => {
      if (!focusLost()) return
      const key = from?.isConnected ? from : (row.current?.querySelector<HTMLElement>('[data-testid="pb-filter"], [data-testid="pb-more"]') ?? null)
      if (key) restoreFocus(key)
    })
  }

  const entries: MenuEntry[] = [
    ...(tier === 'tight' && keys.patch ? [{ label: t(`${P}.patching`), icon: <Cable size={14} />, checked: keys.patch.on, onSelect: () => keys.patch!.set(!keys.patch!.on) }] : []),
    { label: t(`${P}.asList`), icon: <List size={14} />, onSelect: keys.asList },
    ...(tier === 'tight' && input ? [{ label: filterLabel(t, filter, input), icon: <ListFilter size={14} />, onSelect: () => setFilterAt(moreBtn.current) }] : []),
    ...(keys.picture ? [{ label: t(`${P}.picture`), icon: <Maximize2 size={14} />, onSelect: () => keys.picture!(moreBtn.current) }] : []),
    ...(keys.drop ? [{ label: t(`${P}.drop`), icon: <FileJson size={14} />, onSelect: () => keys.drop!(moreBtn.current) }] : []),
  ]

  return (
    <div className="pb-head" ref={row} data-tier={tier}>
      <img className="pb-head__icon" src={resolveAssetUrl('assets/icons/automation.webp')} alt="" />
      <h1 className="display pb-title" ref={h1} tabIndex={-1}>
        {t(`${P}.title`)}
      </h1>
      <span className="label pb-head__sub">{t(`${P}.sub`)}</span>
      <span className="pb-head__sp" />
      {tier !== 'tight' && keys.patch && (
        <label className="pb-patchsw" title={t(`${P}.patchingTitle`)} data-on={keys.patch.on || undefined} data-testid="pb-patching">
          <Switch size="sm" checked={keys.patch.on} onChange={keys.patch.set} label={t(`${P}.patching`)} seed="patchbay-patching" />
          <span className="label pb-patchsw__l" aria-hidden="true">
            {t(`${P}.patching`)}
          </span>
        </label>
      )}
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
        <button type="button" className="pb-drop" title={t(`${P}.dropTitle`)} aria-haspopup="true" onClick={(e) => keys.drop!(e.currentTarget)} data-testid="pb-drop">
          <FileJson size={14} strokeWidth={1.7} aria-hidden="true" />
          {t(`${P}.drop`)}
        </button>
      )}
      {tier !== 'full' && <MoreKey ref={moreBtn} label={t(`${P}.more`)} onClick={more.toggle} open={more.open} />}
      <Menu {...more.props} entries={entries} placement="bottom-end" width={240} />
      {input && <FilterPanel t={t} input={input} filter={filter} profiles={profiles} hasFuses={hasFuses} anchor={filterAt} onClose={closeFilter} />}
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

