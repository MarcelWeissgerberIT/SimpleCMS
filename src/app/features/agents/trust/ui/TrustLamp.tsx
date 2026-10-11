/**
 * Per-field trust — a key's state as a mono lamp: DIREKT (ink, its LED lit) · FREIGEBBAR (ink outline) · PRÜFUNG
 * (muted outline) · NIE (dashed). A key granted but not in effect here reads PRÜFUNG (its note says why).
 */
import { useT } from '../../../../i18n'
import type { Lamp } from '../rules'

export function TrustLamp({ lamp }: { lamp: Lamp }) {
  const t = useT()
  const shown = lamp === 'idle' ? 'review' : lamp
  return (
    <span className="agt-lamp" data-lamp={shown}>
      {shown === 'direct' && <span className="led led--on" aria-hidden />}
      {t(`features.agents.trust.lamp.${shown}`)}
    </span>
  )
}
