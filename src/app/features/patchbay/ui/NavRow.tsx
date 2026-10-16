/**
 * The sidebar's "Patchbay" / "Schaltplan" row (§1.8, §3.2), between Scripts and Building blocks; always shown, viewers
 * too. The badge is the Agents row's markup: an LED and the number of OPEN fuses (an allowed one is not open, a lapsed
 * one is) in signal; no open fuse but parts unknown here → a grey "?" (unknown never reads as safe); viewers and
 * read-only members see it in neutral ink — they cannot act on it. A "NEW" / "NEU" ink tag until this device first
 * opens the page (ui/seen.ts). The numbers are the readout's (counts.ts: LED = lamp = readout).
 */
import type { ButtonHTMLAttributes, Ref } from 'react'
import { Cable } from 'lucide-react'
import { useT } from '../../../i18n'
import { useCloud } from '../../../cloud'
import { usePatchbayCounts } from '../counts'
import { openPatchbay } from '../open'
import { useSeen } from './seen'
import './nav.css'

const P = 'features.patchbay'

/** The strip's roving focus and its accessible name for the key (shell/sidebar/Tools.tsx). */
export type PatchbayKeyProps = ButtonHTMLAttributes<HTMLButtonElement> & { ref?: Ref<HTMLButtonElement> }

/**
 * `variant` 'key': one key of the sidebar's tool strip (shell/sidebar/Tools.tsx) — the same LED + count or grey "?" in
 * the key's corner (the viewer's neutral ink too), NEW as a dot (the strip's readout says it in words), the name hidden
 * on a fine pointer (the readout and the accessible name carry it), the same test ids. `keyProps`: the strip's roving
 * tabindex, keys and name.
 */
export function PatchbayNavRow({ active, variant = 'row', keyProps }: { active?: boolean; variant?: 'row' | 'key'; keyProps?: PatchbayKeyProps }) {
  const t = useT()
  const seen = useSeen()
  const counts = usePatchbayCounts()
  const viewer = useCloud((s) => s.readOnly)
  const open = counts.ready ? counts.open : 0
  const unknown = counts.ready ? counts.unknown : 0
  const said = open > 0 ? t(open === 1 ? `${P}.nav.fuses.one` : `${P}.nav.fuses`, { n: open }) : unknown > 0 ? t(unknown === 1 ? `${P}.nav.unknown.one` : `${P}.nav.unknown`, { n: unknown }) : ''
  if (variant === 'key') {
    const title = t(`${P}.title`)
    return (
      <button
        type="button"
        className="sb-tool pb-navrow"
        data-active={active || undefined}
        aria-current={active ? 'page' : undefined}
        aria-label={[title, said, seen ? '' : t(`${P}.new`)].filter(Boolean).join(', ')}
        onClick={() => openPatchbay()}
        data-testid="patchbay-nav"
        {...keyProps}
      >
        <span className="sb-tool__icon" aria-hidden>
          <Cable size={16} />
        </span>
        <span className="sb-tool__label">{title}</span>
        {!seen && (
          <span className="pb-newtag sb-tool__new" data-testid="patchbay-nav-new">
            <span className="visually-hidden">{t(`${P}.new`)}</span>
          </span>
        )}
        {open > 0 ? (
          <span className="sb-navrow__badge pb-navbadge" data-viewer={viewer || undefined} data-testid="patchbay-nav-led">
            <span className={viewer ? 'led' : 'led led--on'} aria-hidden />
            {open > 99 ? '99+' : String(open)}
            <span className="visually-hidden"> {said}</span>
          </span>
        ) : (
          unknown > 0 && (
            <span className="sb-navrow__badge pb-navbadge pb-navbadge--q" data-testid="patchbay-nav-unknown">
              <span aria-hidden>?</span>
              <span className="visually-hidden"> {said}</span>
            </span>
          )
        )}
      </button>
    )
  }
  return (
    <button type="button" className="sb-navrow pb-navrow" data-active={active || undefined} aria-current={active ? 'page' : undefined} onClick={() => openPatchbay()} data-testid="patchbay-nav">
      <span className="sb-navrow__icon">
        <Cable size={16} />
      </span>
      <span className="sb-navrow__label">{t(`${P}.title`)}</span>
      {!seen && (
        <span className="pb-newtag" data-testid="patchbay-nav-new">
          {t(`${P}.new`)}
        </span>
      )}
      {open > 0 ? (
        <span className="sb-navrow__badge pb-navbadge" data-viewer={viewer || undefined} data-testid="patchbay-nav-led" title={said}>
          <span className={viewer ? 'led' : 'led led--on'} aria-hidden />
          {open > 99 ? '99+' : String(open)}
          <span className="visually-hidden"> {said}</span>
        </span>
      ) : (
        unknown > 0 && (
          <span className="sb-navrow__badge pb-navbadge pb-navbadge--q" data-testid="patchbay-nav-unknown" title={said}>
            <span aria-hidden>?</span>
            <span className="visually-hidden"> {said}</span>
          </span>
        )
      )}
    </button>
  )
}
