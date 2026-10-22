/**
 * Renders a parsed help article (or Claude's Markdown answer) as React — headings, steps, notes,
 * keycaps. `help:<id>` links open the article in the panel; web links open in a new tab.
 */
import { Fragment, type ReactNode } from 'react'
import { shortcutLabel, shortcutText } from '../ui/controls'
import { helpLinkId, type Block, type Inline } from './markdown'
import type { Range } from './search'

/** How article links behave: open in the panel on click, the public page as their address (new tab, copy link). */
export interface DocNav {
  open: (id: string) => void
  href: (id: string) => string
}

export interface DocProps {
  blocks: Block[]
  nav: DocNav
  className?: string
  /** Normalize legacy shortcut prose only in the bundled manual, never arbitrary answers. */
  platformKeys?: boolean
}

/** "Mod+K" → the platform's label (⌘K / Ctrl+K); single keys and words stay as written. */
export const keyLabel = shortcutLabel

export function Doc({ blocks, nav, className, platformKeys = false }: DocProps) {
  return (
    <div className={`help-doc${className ? ` ${className}` : ''}`}>
      {blocks.map((b, i) => (
        <BlockView key={i} block={b} nav={nav} platformKeys={platformKeys} />
      ))}
    </div>
  )
}

function BlockView({ block: b, nav, platformKeys }: { block: Block; nav: DocNav; platformKeys: boolean }) {
  const inl = (c: Inline[]) => <Inlines nodes={c} nav={nav} platformKeys={platformKeys} />
  switch (b.t) {
    case 'h2':
      return <h4 className="help-doc__h2">{inl(b.c)}</h4>
    case 'h3':
      return <h5 className="help-doc__h3">{inl(b.c)}</h5>
    case 'p':
      return <p>{inl(b.c)}</p>
    case 'note':
      return (
        <p className="help-doc__note">
          <span className="help-doc__noteMark" aria-hidden>
            !
          </span>
          <span>{inl(b.c)}</span>
        </p>
      )
    case 'ul':
      return (
        <ul>
          {b.items.map((it, i) => (
            <li key={i}>{inl(it)}</li>
          ))}
        </ul>
      )
    case 'ol':
      return (
        <ol className="help-doc__steps">
          {b.items.map((it, i) => (
            <li key={i}>
              <span className="help-doc__step" aria-hidden>
                {String(i + 1).padStart(2, '0')}
              </span>
              <span>{inl(it)}</span>
            </li>
          ))}
        </ol>
      )
    case 'pre':
      return (
        <pre className="help-doc__pre">
          <code>{b.v}</code>
        </pre>
      )
  }
}

export function Inlines({ nodes, nav, platformKeys = false }: { nodes: Inline[]; nav: DocNav; platformKeys?: boolean }): ReactNode {
  return nodes.map((n, i) => {
    switch (n.t) {
      case 'text':
        return <Fragment key={i}>{platformKeys ? shortcutText(n.v) : n.v}</Fragment>
      case 'b':
        return (
          <strong key={i}>
            <Inlines nodes={n.c} nav={nav} platformKeys={platformKeys} />
          </strong>
        )
      case 'i':
        return (
          <em key={i}>
            <Inlines nodes={n.c} nav={nav} platformKeys={platformKeys} />
          </em>
        )
      case 'code':
        return <code key={i}>{n.v}</code>
      case 'kbd':
        return (
          <kbd key={i} className="kbd help-doc__kbd">
            {platformKeys || !/[⌘⌥⇧⌃]/.test(n.v) ? keyLabel(n.v) : n.v}
          </kbd>
        )
      case 'link': {
        const id = helpLinkId(n.href)
        if (id)
          return (
            <a
              key={i}
              href={nav.href(id)}
              className="help-doc__link"
              data-help-link={id}
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
                e.preventDefault()
                nav.open(id)
              }}
            >
              <Inlines nodes={n.c} nav={nav} platformKeys={platformKeys} />
            </a>
          )
        const safe = /^https?:\/\//i.test(n.href)
        return safe ? (
          <a key={i} href={n.href} target="_blank" rel="noopener noreferrer" className="help-doc__link help-doc__link--out">
            <Inlines nodes={n.c} nav={nav} platformKeys={platformKeys} />
          </a>
        ) : (
          <Fragment key={i}>
            <Inlines nodes={n.c} nav={nav} platformKeys={platformKeys} />
          </Fragment>
        )
      }
    }
  })
}

/** Text with <mark>ed ranges (search hits). */
export function Marked({ text, ranges }: { text: string; ranges: Range[] }): ReactNode {
  if (!ranges.length) return text
  const out: ReactNode[] = []
  let pos = 0
  ranges.forEach(([a, b], i) => {
    if (a < pos) return
    if (a > pos) out.push(<Fragment key={`t${i}`}>{text.slice(pos, a)}</Fragment>)
    out.push(<mark key={`m${i}`}>{text.slice(a, b + 1)}</mark>)
    pos = b + 1
  })
  if (pos < text.length) out.push(<Fragment key="end">{text.slice(pos)}</Fragment>)
  return out
}
