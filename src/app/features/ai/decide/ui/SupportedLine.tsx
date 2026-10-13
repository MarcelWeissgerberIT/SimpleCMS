/**
 * The "Belegt?" line under an answer (slice SJ, § 2.5): unsupported → the amber cap NOT SUPPORTED, what Jev found and
 * "Ask more thoroughly (R)" (the class's deep role — the person's press, never by itself); declined → neutral "the answer
 * says: not in the sources"; supported → a dim line without a number (never a stamp); not checked → a dim note why.
 * R belongs to the line's own surface: it works only while the focus is inside the dialog that holds the line (the help
 * panel, the AI menu) — never in a field or a menu there, never from the page behind it. The live region stands from the
 * first state on (a region inserted with its text is not read out) and says what Jev found.
 */
import { useEffect, useRef } from 'react'
import { useT } from '../../../../i18n'
import { whyText } from '../text'
import type { VerifyResult } from '../verify'
import '../decide.css'

/** Does R belong to this line? The focus is inside the line's own surface and not in a field, a menu or a nested dialog. */
function ownsKey(el: Element | null, line: Element | null): boolean {
  if (!el || !line) return false
  const host = line.closest('[role="dialog"]') ?? line.parentElement
  if (!host?.contains(el)) return false
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable) return false
  if (el.closest('[role="menu"], [role="listbox"]')) return false
  const dialog = el.closest('[role="dialog"]')
  return !dialog || dialog.contains(line)
}

export function SupportedLine({ result, onDeeper, disabled }: { result: VerifyResult | 'checking'; onDeeper?: (() => void) | null; disabled?: boolean }) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const unsupported = result !== 'checking' && result.support === 'unsupported'
  // R: ask again, more thoroughly — only on a press, only while the line offers it, only on its own surface
  useEffect(() => {
    if (!unsupported || !onDeeper || disabled) return
    const on = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || e.altKey || e.ctrlKey || e.metaKey || (e.key !== 'r' && e.key !== 'R')) return
      if (!ownsKey(document.activeElement, ref.current)) return
      e.preventDefault()
      onDeeper()
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [unsupported, onDeeper, disabled])
  const state = result === 'checking' ? 'checking' : (result.support ?? 'skipped')
  return (
    <div ref={ref} className={result === 'checking' ? 'jev-sup jev-line__dim' : 'jev-sup'} data-state={state} data-testid="jev-sup">
      {result === 'checking' ? (
        <span className="jev-sup__text">{t('features.ai.jev.verify.checking')}</span>
      ) : unsupported ? (
        <>
          <span className="jev-cap">{t('features.ai.jev.verify.no')}</span>
          <span className="jev-sup__text">{t('features.ai.jev.verify.noLine')}</span>
          {onDeeper && (
            <button type="button" className="btn btn--sm jev-sup__deeper" onClick={onDeeper} disabled={disabled} aria-keyshortcuts="R" data-testid="jev-deeper">
              {t('features.ai.jev.verify.deeper')} <kbd className="kbd">R</kbd>
            </button>
          )}
        </>
      ) : state === 'declined' ? (
        <span className="jev-sup__text">{t('features.ai.jev.verify.declined')}</span>
      ) : state === 'supported' ? (
        <span className="jev-sup__text jev-line__dim">{t('features.ai.jev.verify.clear')}</span>
      ) : (
        <span className="jev-sup__text jev-line__dim">{t('features.ai.jev.verify.skipped', { why: whyText(t, result.why, undefined) })}</span>
      )}
      <span className="visually-hidden" role="status">
        {unsupported ? t('features.ai.jev.verify.noLive') : ''}
      </span>
    </div>
  )
}
