import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Check, Copy } from 'lucide-react'
import { useUI } from '../../store/ui'
import { useT } from '../../i18n'
import { Led } from '../../ui/controls'
import { plural } from '../lib/format'
import type { Translate } from '@/shared/i18n'

/** Copy `text`; the button answers "Copied" for a moment (and says so to screen readers). */
export function CopyButton({ text, fallback, label, primary, small }: { text: string; fallback?: RefObject<HTMLInputElement | null>; label?: string; primary?: boolean; small?: boolean }) {
  const t = useT()
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const id = window.setTimeout(() => setCopied(false), 1800)
    return () => window.clearTimeout(id)
  }, [copied])
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
    } catch {
      // no clipboard (permissions, insecure origin): select it for ⌘C / Ctrl+C
      fallback?.current?.focus()
      fallback?.current?.select()
      useUI.getState().toast({ message: t('shell.cloud.clip.failed'), kind: 'error' })
    }
  }
  return (
    <button type="button" className={`btn ${primary ? 'btn--primary' : ''} ${small ? 'btn--sm' : ''} cl-copy`} data-copied={copied || undefined} onClick={() => void copy()}>
      {copied ? <Check size={13} strokeWidth={2.2} aria-hidden /> : <Copy size={13} aria-hidden />}
      <span aria-live="polite">{copied ? t('shell.cloud.clip.copied') : (label ?? t('shell.cloud.clip.copy'))}</span>
    </button>
  )
}

/** A link shown once: LED + label, the link in a mono field with Copy, a spec line and a hint. */
export function LinkPanel({ label, link, spec, hint, testId, children }: { label: string; link: string; spec?: string; hint: string; testId?: string; children?: ReactNode }) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <div className="tm-link" data-testid={testId} role="group" aria-label={label}>
      <div className="tm-link__head">
        <Led state="on" />
        <span className="label">{label}</span>
      </div>
      <div className="tm-link__row">
        <input ref={ref} className="input tm-link__url" readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label={label} spellCheck={false} />
        <CopyButton text={link} fallback={ref} primary />
      </div>
      {spec && <p className="tm-spec">{spec}</p>}
      <p className="tm-link__hint">{hint}</p>
      {children}
    </div>
  )
}

/** "7 DAYS · 3/10 USED · @ACME.COM" — the spec line of an invite or registration link (upper-cased by CSS). */
export function linkSpec(t: Translate, x: { days?: number; maxUses?: number; uses?: number; domains?: string[] | null }): string {
  const parts: string[] = []
  if (x.days !== undefined) parts.push(t(plural('shell.cloud.inv.spec.days', x.days), { n: x.days }))
  const max = x.maxUses ?? 1
  parts.push(max === 1 && !x.uses ? t('shell.cloud.inv.spec.single') : t('shell.cloud.inv.spec.used', { uses: x.uses ?? 0, max }))
  if (x.domains?.length) parts.push(x.domains.map((d) => `@${d}`).join(' '))
  return parts.join(' · ')
}

/** Whole days between now and `ms` (at least 1): a link created "for 7 days" reads 7, not 6. */
export const daysLeft = (ms: number) => Math.max(1, Math.round((ms - Date.now()) / 86_400_000))

const DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/

/** "@Acme.com, acme.de" → ['acme.com', 'acme.de']; null when one entry is not a domain. */
export function parseDomainInput(raw: string): string[] | null {
  const list = [...new Set(raw.split(/[\s,;]+/).map((d) => d.trim().toLowerCase().replace(/^@/, '')).filter(Boolean))]
  return list.every((d) => DOMAIN_RE.test(d)) ? list : null
}

/** Addresses from a pasted list: commas, semicolons, spaces or lines; "Ada <ada@acme.com>" keeps the address. */
export function parseAddressList(raw: string): string[] {
  const plain = raw.replace(/[^<>,;\n]*<([^>]*)>/g, '$1,')
  return [...new Set(plain.split(/[\s,;]+/).map((a) => a.trim().toLowerCase()).filter(Boolean))]
}
