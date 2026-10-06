/** Small building parts of the workspace page: section heads, sub-heads, spec read-outs, avatars. */
import type { CSSProperties, ReactNode } from 'react'
import { ArrowRight } from 'lucide-react'
import type { Person } from '../../store/types'
import { tagStyle } from '../../lib/colors'
import { HelpLink } from '../../help'

/** "§ 02 — PEOPLE" + the section's title and one line of what it is. */
export function SectionHead({ n, title, lead, help, children }: { n: string; title: string; lead?: ReactNode; help?: string; children?: ReactNode }) {
  return (
    <header className="wsp-head">
      <div className="wsp-head__row">
        <h2 className="wsp-head__title" id="wsp-section-title">
          <span className="wsp-head__n">§ {n}</span>
          {title}
          {help && <HelpLink id={help} />}
        </h2>
        {children}
      </div>
      {lead && <p className="wsp-head__lead">{lead}</p>}
    </header>
  )
}

/** A dotted sub-head inside a section: label, rule, optional count, optional keys on the right. */
export function SubHead({ label, count, id, children }: { label: string; count?: number; id?: string; children?: ReactNode }) {
  return (
    <div className="wsp-sub">
      <h3 className="label wsp-sub__label" id={id}>
        {label}
      </h3>
      <span className="wsp-sub__rule" aria-hidden />
      {count !== undefined && <span className="wsp-sub__count">{String(count).padStart(2, '0')}</span>}
      {children}
    </div>
  )
}

/** A grid of spec read-outs: mono label over a value. */
export function Spec({ items, testId }: { items: Array<{ label: string; value: ReactNode; hint?: string }>; testId?: string }) {
  return (
    <dl className="wsp-spec" data-testid={testId}>
      {items.map((it) => (
        <div key={it.label} className="wsp-spec__cell" title={it.hint}>
          <dt>{it.label}</dt>
          <dd>{it.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** A link-styled row key: "Open →". */
export function GoKey({ label, onClick, href, testId, ariaLabel }: { label: string; onClick?: () => void; href?: string; testId?: string; ariaLabel?: string }) {
  if (href)
    return (
      <a className="btn btn--sm btn--ghost wsp-go" href={href} data-testid={testId} aria-label={ariaLabel}>
        {label}
        <ArrowRight size={13} aria-hidden />
      </a>
    )
  return (
    <button type="button" className="btn btn--sm btn--ghost wsp-go" onClick={onClick} data-testid={testId} aria-label={ariaLabel}>
      {label}
      <ArrowRight size={13} aria-hidden />
    </button>
  )
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : (parts[0][1] ?? ''))).toUpperCase()
}

/** A person's initials on their colour (the same look as person cells). */
export function PersonAvatar({ person, size = 28 }: { person: Pick<Person, 'name' | 'color'>; size?: number }) {
  const style: CSSProperties = { ...tagStyle(person.color), width: size, height: size, fontSize: Math.round(size * 0.42) }
  return (
    <span className="wsp-avatar" style={style} aria-hidden>
      {initialsOf(person.name)}
    </span>
  )
}
