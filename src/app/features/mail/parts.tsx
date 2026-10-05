/** Settings → Mail building blocks: an instrument panel (§ code, title, LED read-out), a field, a switch row. */
import type { ReactNode } from 'react'
import { Led, Switch } from '../../ui/controls'
import type { ReadoutState } from './MailStatus'

export function Panel({ id, code, title, state, stateText, children }: { id: string; code: string; title: string; state: ReadoutState; stateText: string; children: ReactNode }) {
  return (
    <section className="ml-panel" aria-labelledby={`${id}-h`} data-state={state}>
      <header className="ml-panel__head">
        <span className="label ml-panel__code" id={`${id}-h`}>
          {code} — {title}
        </span>
        <span className="ml-panel__state" role="status">
          <Led state={state === 'ok' ? 'ok' : state === 'running' || state === 'reconnect' ? 'on' : 'off'} />
          <span className="label">{stateText}</span>
        </span>
      </header>
      <div className="ml-panel__body">{children}</div>
    </section>
  )
}

export function MlField({ label, hint, htmlFor, children, wide }: { label: string; hint?: ReactNode; htmlFor?: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className="ml-field" data-wide={wide || undefined}>
      {htmlFor ? (
        <label className="ml-field__label" htmlFor={htmlFor}>
          {label}
        </label>
      ) : (
        <div className="ml-field__label">{label}</div>
      )}
      {children}
      {hint && (
        <div className="ml-field__hint" id={htmlFor ? `${htmlFor}-hint` : undefined}>
          {hint}
        </div>
      )}
    </div>
  )
}

export function SwitchRow({ label, hint, checked, onChange, disabled, children }: { label: string; hint?: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; children?: ReactNode }) {
  return (
    <div className="ml-row">
      <Switch checked={checked} onChange={onChange} label={label} disabled={disabled} />
      <span className="ml-row__text">
        <span className="ml-row__label">{label}</span>
        {hint && <span className="ml-field__hint">{hint}</span>}
      </span>
      {children}
    </div>
  )
}
