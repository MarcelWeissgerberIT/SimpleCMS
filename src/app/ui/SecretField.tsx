/**
 * A secret's field (the Claude API key, the GitHub token). Set: a sealed readout "🔒 •••• 1a2B" with
 * Replace / Remove and "Stored encrypted on this device" — the secret itself is never shown again.
 * Not set (or replacing): a password input with show/hide and Save (↵).
 *
 * The parent seals: onSubmit gets the typed secret, `marker` is what the store keeps (lib/vault.ts).
 */
import { useEffect, useRef, useState } from 'react'
import { Eye, EyeOff, LockKeyhole, X } from 'lucide-react'
import { markerHint, vaultAvailable } from '../lib/vault'
import { useT } from '../i18n'
import { Led } from './controls'
import './secret-field.css'

export interface SecretFieldProps {
  /** id of the input (a <label htmlFor> names it) */
  id: string
  /** accessible name of the field (the sealed readout's group) */
  label: string
  /** the stored marker; '' = nothing set */
  marker: string
  /** the typed secret (controlled) */
  value: string
  onChange: (value: string) => void
  /** Save / ↵ with the trimmed value */
  onSubmit: (value: string) => void
  onRemove: () => void
  placeholder?: string
  describedBy?: string
  showLabel: string
  hideLabel: string
}

export function SecretField({ id, label, marker, value, onChange, onSubmit, onRemove, placeholder, describedBy, showLabel, hideLabel }: SecretFieldProps) {
  const t = useT()
  const [replacing, setReplacing] = useState(false)
  const [show, setShow] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const replaceBtn = useRef<HTMLButtonElement>(null)
  const focusReplace = useRef(false)

  // a new marker (saved, removed, another tab): back to the readout
  useEffect(() => {
    setReplacing(false)
    setShow(false)
  }, [marker])
  useEffect(() => {
    if (replacing) input.current?.focus()
  }, [replacing])
  // after Save / Cancel the focus lands on Replace (the input it was in is gone)
  useEffect(() => {
    if (!focusReplace.current || !replaceBtn.current) return
    focusReplace.current = false
    replaceBtn.current.focus()
  })

  if (marker && !replacing) {
    const last4 = markerHint(marker)
    return (
      <div className="secret" role="group" aria-label={label} aria-describedby={describedBy}>
        <div className="secret__box">
          <LockKeyhole className="secret__lock" size={14} strokeWidth={1.75} aria-hidden />
          <span className="secret__value" aria-hidden>
            •••• {last4}
          </span>
          <span className="visually-hidden">{last4 ? t('ui.secret.endsIn', { last4 }) : t('ui.secret.set')}</span>
          <span className="secret__actions">
            <button ref={replaceBtn} type="button" className="btn btn--sm" onClick={() => setReplacing(true)}>
              {t('ui.secret.replace')}
            </button>
            <button type="button" className="btn btn--sm btn--ghost" onClick={onRemove}>
              {t('common.remove')}
            </button>
          </span>
        </div>
        <div className="secret__state label">
          <Led state={vaultAvailable() ? 'ok' : 'on'} />
          {vaultAvailable() ? t('ui.secret.sealed') : t('ui.secret.session')}
        </div>
      </div>
    )
  }

  const cancel = () => {
    onChange('')
    focusReplace.current = true
    setReplacing(false)
  }
  return (
    <form
      className="secret secret--edit"
      onSubmit={(e) => {
        e.preventDefault()
        if (!value.trim()) return
        focusReplace.current = true
        onSubmit(value.trim())
      }}
    >
      <div className="secret__box secret__box--edit">
        <input
          ref={input}
          id={id}
          className="input secret__input"
          type={show ? 'text' : 'password'}
          value={value}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          aria-describedby={describedBy}
          onFocus={() => (focusReplace.current = false)}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && replacing) {
              e.preventDefault()
              e.stopPropagation()
              cancel()
            }
          }}
        />
        <button type="button" className="icon-btn" onClick={() => setShow(!show)} aria-label={show ? hideLabel : showLabel} aria-pressed={show}>
          {show ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
        <button type="submit" className="btn btn--sm btn--primary secret__save" disabled={!value.trim()}>
          {t('common.save')}
        </button>
        {replacing && (
          <button type="button" className="icon-btn" onClick={cancel} aria-label={t('common.cancel')} title={t('common.cancel')}>
            <X size={15} />
          </button>
        )}
      </div>
    </form>
  )
}
