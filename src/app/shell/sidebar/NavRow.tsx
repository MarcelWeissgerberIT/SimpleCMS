import type { ReactNode } from 'react'

/** A fixed row of the sidebar (the places; the tools with their names): icon, label, a badge or a keycap. */
export function NavRow({ icon, label, kbd, active, badge, ariaLabel, onClick }: { icon: ReactNode; label: string; kbd?: string; active?: boolean; badge?: ReactNode; ariaLabel?: string; onClick: () => void }) {
  return (
    <button type="button" className="sb-navrow" data-active={active || undefined} aria-current={active ? 'page' : undefined} aria-label={ariaLabel} onClick={onClick}>
      <span className="sb-navrow__icon">{icon}</span>
      <span className="sb-navrow__label">{label}</span>
      {badge}
      {kbd && <span className="kbd sb-navrow__kbd">{kbd}</span>}
    </button>
  )
}
