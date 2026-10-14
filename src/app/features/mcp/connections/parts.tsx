/**
 * MCP · Connections — the page's parts: a section head (§ 0n — CODE, a dotted rule, the scope chip, the count), a row
 * (LED · NAME + host · state word · reason · keys, facts below), the facts list, the LED and the "Settings ↗" key.
 */
import { createContext, useContext, useEffect, useId, useRef, type ReactNode, type RefObject } from 'react'
import { ArrowUpRight } from 'lucide-react'
import { canFocus, focusIsNowhere } from '../../../ui/focus'
import type { Level } from './model'

/** The page's polite live region: what a Test / Sign in started here came to. */
export const AnnounceContext = createContext<(text: string) => void>(() => {})
export const useAnnounce = () => useContext(AnnounceContext)

export function Lamp({ level, live }: { level: Level; live?: boolean }) {
  const tone = level === 'ok' ? ' led--ok' : level === 'on' ? ' led--on' : level === 'red' ? ' mcpc-led--red' : level === 'amber' ? ' mcpc-led--amber' : ''
  return <span className={`led mcpc-led${tone}${live ? ' mcpc-led--live' : ''}`} data-level={level} aria-hidden />
}

export function Section({ n, code, scope, count, title, note, children, testId }: { n: string; code: string; scope: string; count?: number; title: string; note: string; children: ReactNode; testId: string }) {
  const id = useId()
  return (
    <section className="mcpc-sec" aria-labelledby={id} data-testid={testId}>
      <div className="mcpc-sec__head">
        <h2 className="label mcpc-sec__code" id={id}>
          <span className="mcpc-sec__n">§ {n}</span> — {code}
        </h2>
        <span className="mcpc-sec__rule" aria-hidden />
        <span className="mcpc-chip" data-testid={`${testId}-scope`}>
          {scope}
        </span>
        {count !== undefined && (
          <span className="mcpc-sec__count" aria-hidden>
            {String(count).padStart(2, '0')}
          </span>
        )}
      </div>
      <p className="mcpc-sec__lead">
        <span className="mcpc-sec__title">{title}</span> — <span className="mcpc-sec__note">{note}</span>
      </p>
      {children}
    </section>
  )
}

export interface RowProps {
  kind: 'one' | 'bridge' | 'worker' | 'team' | 'srv'
  name: string
  host?: ReactNode
  level: Level
  live?: boolean
  word?: string
  /** a red / amber word gets the LED's tone as a bar (never colour alone — the word says it) */
  tone?: 'red' | 'amber'
  reason?: ReactNode
  keys?: ReactNode
  facts?: ReactNode
  children?: ReactNode
  attrs?: Record<string, string | undefined>
  testId?: string
}

/**
 * A key of the row that goes away while it holds the keyboard (its work done: signed in, read, connected, a code
 * cancelled) hands the keyboard to the row's home key (its "Settings ↗", `data-home`) — never to the page body. Only a
 * key that is gone: one the person left by clicking elsewhere keeps nothing.
 */
function useKeepFocus(ref: RefObject<HTMLLIElement | null>): void {
  useEffect(() => {
    const li = ref.current
    if (!li) return
    let last: Element | null = null
    const rescue = () => {
      if (!last || last.isConnected || !focusIsNowhere()) return
      last = null
      const home = li.querySelector<HTMLElement>('[data-home]')
      if (canFocus(home)) home.focus({ preventScroll: true })
    }
    const onIn = (e: FocusEvent) => {
      last = e.target as Element
    }
    const onOut = (e: FocusEvent) => {
      // focus moved on to another element (in the row: focusin notes it): nothing to keep
      if (e.relatedTarget) {
        if (!li.contains(e.relatedTarget as Node)) last = null
        return
      }
      // to nowhere: the person left it (the key is still here — nothing to keep), or the key went away
      const el = e.target as Element
      requestAnimationFrame(() => {
        if (!el.isConnected) rescue()
        else if (last === el) last = null
      })
    }
    const watch = new MutationObserver(rescue)
    watch.observe(li, { childList: true, subtree: true })
    li.addEventListener('focusin', onIn)
    li.addEventListener('focusout', onOut)
    return () => {
      watch.disconnect()
      li.removeEventListener('focusin', onIn)
      li.removeEventListener('focusout', onOut)
    }
  }, [ref])
}

export function Row({ kind, name, host, level, live, word, tone, reason, keys, facts, children, attrs, testId }: RowProps) {
  const ref = useRef<HTMLLIElement>(null)
  useKeepFocus(ref)
  return (
    <li ref={ref} className="mcpc-row" data-row={kind} data-testing={live || undefined} data-testid={testId} {...attrs}>
      <Lamp level={level} live={live} />
      <div className="mcpc-row__id">
        <span className="mcpc-row__name">{name}</span>
        {host && <span className="mcpc-row__host">{host}</span>}
      </div>
      <span className="mcpc-row__word" data-tone={tone} data-testid="mcpc-word">
        {word}
      </span>
      <div className="mcpc-row__why" data-testid="mcpc-why">
        {reason}
      </div>
      <div className="mcpc-row__keys">{keys}</div>
      {facts}
      {children && <div className="mcpc-row__more">{children}</div>}
    </li>
  )
}

/** The row's facts as an inline list: LABEL value · LABEL value … */
export function Facts({ items }: { items: Array<{ key: string; label: string; value: ReactNode; testId?: string }> }) {
  if (!items.length) return null
  return (
    <dl className="mcpc-facts">
      {items.map((f) => (
        <div key={f.key} className="mcpc-fact" data-fact={f.key} data-testid={f.testId}>
          <dt className="label">{f.label}</dt>
          <dd>{f.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** "Settings ↗" (or another way into Settings): a ghost key, its label naming the row — the row's home key (useKeepFocus). */
export function GoKey({ label, aria, onClick, testId }: { label: string; aria: string; onClick: () => void; testId?: string }) {
  return (
    <button type="button" className="btn btn--sm btn--ghost mcpc-go" onClick={onClick} aria-label={aria} title={aria} data-testid={testId} data-home>
      {label}
      <ArrowUpRight size={12} strokeWidth={1.7} aria-hidden className="mcpc-go__arrow" />
    </button>
  )
}

export const Chip = ({ children, off, title, mono }: { children: ReactNode; off?: boolean; title?: string; mono?: boolean }) => (
  <li className={mono ? 'mcpc-tag mcpc-tag--mono' : 'mcpc-tag'} data-off={off || undefined} title={title}>
    {children}
  </li>
)
