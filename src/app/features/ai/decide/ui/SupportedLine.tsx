/**
 * The "Belegt?" line under an answer (slice SJ, § 2.5): unsupported → the amber cap NOT SUPPORTED, what Jev found and
 * "Ask more thoroughly (R)" (the class's deep role — the person's press, never by itself); declined → neutral "the answer
 * says: not in the sources"; supported → a dim line without a number (never a stamp); not checked → a dim note why.
 * R works while the focus is not in a field or a menu and not in another dialog than the line's own (the help panel and
 * the AI menu are dialogs themselves); a live region says what Jev found.
 */
import { useEffect, useRef } from 'react'
import { useT } from '../../../../i18n'
import { whyText } from '../text'
import type { VerifyResult } from '../verify'
import '../decide.css'

/** Does a letter key belong to the focus rather than to this line? */
function heldElsewhere(el: Element | null, line: Element | null): boolean {
  if (!el) return false
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable) return true
  if (el.closest('[role="menu"], [role="listbox"]')) return true
  const dialog = el.closest('[role="dialog"]')
  return !!dialog && !(line && dialog.contains(line))
}

export function SupportedLine({ result, onDeeper, disabled }: { result: VerifyResult | 'checking'; onDeeper?: (() => void) | null; disabled?: boolean }) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const unsupported = result !== 'checking' && result.support === 'unsupported'
  // R: ask again, more thoroughly — only on a press, only while the line offers it
  useEffect(() => {
    if (!unsupported || !onDeeper || disabled) return
    const on = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || e.altKey || e.ctrlKey || e.metaKey || (e.key !== 'r' && e.key !== 'R')) return
      if (heldElsewhere(e.target as Element, ref.current)) return
      e.preventDefault()
      onDeeper()
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [unsupported, onDeeper, disabled])
  if (result === 'checking')
    return (
      <p className="jev-sup jev-line__dim" data-state="checking" data-testid="jev-sup">
        {t('features.ai.jev.verify.checking')}
      </p>
    )
  const state = result.support ?? 'skipped'
  return (
    <div ref={ref} className="jev-sup" data-state={state} data-testid="jev-sup">
      {unsupported ? (
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
