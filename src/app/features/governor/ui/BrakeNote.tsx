/**
 * The brake note (Regler § 5.5): shown wherever a person's request was refused before sending at the red line (the AI
 * menu's ErrorNote, ⌘K "?", help Ask, the Outbox draft, script consent, image / file panels, Transform, kit, meeting
 * notes, /generate, setup test — wired in B8). Visuals and props only: the static mini bar (needle = spent, dashed =
 * this request, red line), the sentence, and the keys — E "+1 $ once" (only when that makes it fit), B "With <cheaper
 * model> ≈ band" (only when one fits), Esc / Cancel; "Needs ≈ +X $" and, for owners, "Adjust the budget ↗" when E would
 * not do. It takes focus when it appears; its letter keys act only while focus is inside it and not in a field.
 */
import { useEffect, useRef, type KeyboardEvent } from 'react'
import { Gauge } from 'lucide-react'
import { useLang, useT } from '../../../i18n'
import { fmtUsd } from '../../../lib/money'
import { typing } from '../../../ui/keys'
import { useFocusWhenShown } from '../../../ui/focus'
import { fmtBand, fmtLimit } from '../format'
import type { Band } from '../estimate'
import type { RefuseDetail } from '../brake'
import { MiniBar } from './MiniBar'
import './cells.css'

export interface BrakeNoteProps {
  detail: RefuseDetail
  /** the route's label ("Opus 5.5", "OpenRouter · Jev Router") */
  model: string
  band: Band | null
  /** the lowest rest */
  rest: number
  /** the binding line's spend and limit (the bar) */
  line?: { spent: number; limit: number } | null
  allow: number | null
  need: number
  cheaper?: { label: string; band: Band | null } | null
  /** MCP servers attached: the band counts up to this many rounds */
  mcpRounds?: number | null
  /** an owner / admin (or a local workspace): "Adjust the budget ↗" */
  owner?: boolean
  /** take focus when shown (default true) */
  autoFocus?: boolean
  onAllow?: () => void
  onCheaper?: () => void
  onCancel: () => void
  onAdjust?: () => void
}

export function BrakeNote(p: BrakeNoteProps) {
  const t = useT()
  const lang = useLang()
  const ref = useRef<HTMLDivElement>(null)
  const focus = useFocusWhenShown(ref)
  useEffect(() => {
    if (p.autoFocus !== false) focus()
  }, [focus, p.autoFocus])
  const month = p.detail === 'month' || p.detail === 'device-month'
  const canAllow = p.allow !== null && !!p.onAllow && p.detail !== 'noprice' && p.detail !== 'scope'
  const canCheaper = !!p.cheaper && !!p.onCheaper
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      p.onCancel()
      return
    }
    if (e.altKey || e.ctrlKey || e.metaKey || typing(e.target as Element)) return
    const k = e.key.toLowerCase()
    if (k === 'e' && canAllow) {
      e.preventDefault()
      p.onAllow?.()
    } else if (k === 'b' && canCheaper) {
      e.preventDefault()
      p.onCheaper?.()
    }
  }
  const sentence =
    p.detail === 'scope'
      ? t('features.governor.note.scope')
      : p.detail === 'noprice' || !p.band
        ? t('features.governor.note.noprice', { model: p.model })
        : t(month ? 'features.governor.note.overMonth' : 'features.governor.note.over', { band: fmtBand(p.band, lang), rest: fmtUsd(Math.max(0, p.rest), lang) })
  return (
    <div ref={ref} className="gv-note" role="group" aria-label={t('features.governor.note.aria')} tabIndex={-1} onKeyDown={onKey} data-detail={p.detail} data-testid="gv-brake-note">
      <div className="gv-note__head">
        <span className="gv-lamp">
          <Gauge size={12} strokeWidth={1.8} aria-hidden />
          {t('features.governor.halt.lamp')}
        </span>
        <p className="gv-note__msg" role="status">
          {sentence}
        </p>
      </div>
      {p.line && p.band && <MiniBar spent={p.line.spent} add={p.band.high} limit={p.line.limit} />}
      {!!p.mcpRounds && <p className="gv-note__sub">{t('features.governor.note.mcp', { n: p.mcpRounds })}</p>}
      <div className="gv-note__keys">
        {canAllow && (
          <button type="button" className="btn btn--primary gv-key" onClick={p.onAllow}>
            <span className="kbd">E</span>
            {t('features.governor.note.allow', { usd: fmtLimit(p.allow ?? 0, lang) })}
          </button>
        )}
        {canCheaper && p.cheaper && (
          <button type="button" className="btn gv-key" onClick={p.onCheaper}>
            <span className="kbd">B</span>
            {t('features.governor.note.cheaper', { model: p.cheaper.label, band: p.cheaper.band ? fmtBand(p.cheaper.band, lang) : '—' })}
          </button>
        )}
        <button type="button" className="btn btn--ghost gv-key" onClick={p.onCancel}>
          <span className="kbd">Esc</span>
          {t('features.governor.note.cancel')}
        </button>
        <span className="gv-spacer" />
        {canAllow ? (
          <span className="gv-note__aside label">{t('features.governor.note.once')}</span>
        ) : p.detail !== 'scope' && p.detail !== 'noprice' && p.need > 0 ? (
          <span className="gv-note__aside label">
            {t('features.governor.note.need', { usd: fmtUsd(p.need, lang) })}
            {p.owner && p.onAdjust && (
              <>
                {' · '}
                <button type="button" className="gv-link" onClick={p.onAdjust}>
                  {t('features.governor.note.adjust')}
                </button>
              </>
            )}
          </span>
        ) : null}
      </div>
    </div>
  )
}
