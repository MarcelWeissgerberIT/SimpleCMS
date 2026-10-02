/**
 * Tiny, safe Markdown → React renderer for streaming AI output (no innerHTML).
 * Handles headings, paragraphs, (nested) bullet / ordered / task lists, quotes, code fences,
 * rules, simple tables and inline bold / italic / strike / code / links / [[citations]].
 * Tolerates half-written input (the stream may stop mid-token).
 */
import { Fragment, memo, type ReactNode } from 'react'

export interface Citation {
  title: string
  href?: string
}

interface Props {
  source: string
  /** Resolve a [[Page title]] citation to a link (or undefined → plain text). */
  resolveCitation?: (title: string) => Citation | undefined
  className?: string
}

type Block =
  | { t: 'h'; level: number; text: string }
  | { t: 'p'; text: string }
  | { t: 'quote'; text: string }
  | { t: 'code'; lang: string; text: string }
  | { t: 'hr' }
  | { t: 'list'; items: ListItem[] }
  | { t: 'table'; rows: string[][] }

interface ListItem {
  depth: number
  ordered: boolean
  num: number
  task: null | boolean
  text: string
}

const LIST_RE = /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/

function parse(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  const out: Block[] = []
  let para: string[] = []
  const flush = () => {
    if (para.length) out.push({ t: 'p', text: para.join('\n') })
    para = []
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const fence = line.match(/^\s*```(\w*)/)
    if (fence) {
      flush()
      const body: string[] = []
      i++
      while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++])
      out.push({ t: 'code', lang: fence[1], text: body.join('\n') })
      continue
    }
    if (!line.trim()) {
      flush()
      continue
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/)
    if (h) {
      flush()
      out.push({ t: 'h', level: Math.min(h[1].length, 3), text: h[2] })
      continue
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush()
      out.push({ t: 'hr' })
      continue
    }
    if (/^\s*>/.test(line)) {
      flush()
      const body: string[] = []
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ''))
      i--
      out.push({ t: 'quote', text: body.join('\n') })
      continue
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      flush()
      const rows: string[][] = []
      while (i < lines.length && /^\s*\|.*\|?\s*$/.test(lines[i])) {
        const cells = lines[i]
          .trim()
          .replace(/^\||\|$/g, '')
          .split('|')
          .map((c) => c.trim())
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells)
        i++
      }
      i--
      out.push({ t: 'table', rows })
      continue
    }
    const li = line.match(LIST_RE)
    if (li) {
      flush()
      const items: ListItem[] = []
      while (i < lines.length) {
        const m = lines[i].match(LIST_RE)
        if (!m) {
          // lazy continuation line of the previous item
          if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && items.length) {
            items[items.length - 1].text += ' ' + lines[i].trim()
            i++
            continue
          }
          break
        }
        const task = m[3].match(/^\[([ xX])\]\s*(.*)$/)
        items.push({
          depth: Math.min(Math.floor(m[1].replace(/\t/g, '  ').length / 2), 4),
          ordered: /\d/.test(m[2]),
          num: parseInt(m[2], 10) || 1,
          task: task ? task[1] !== ' ' : null,
          text: task ? task[2] : m[3],
        })
        i++
      }
      i--
      out.push({ t: 'list', items })
      continue
    }
    para.push(line)
  }
  flush()
  return out
}

const INLINE_RE = /(\[\[[^\]\n]+\]\]|\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|`[^`\n]+`|\[[^\]\n]+\]\([^)\s]+\)|\*[^*\n]+\*|_[^_\n]+_)/g

function inline(text: string, resolve: Props['resolveCitation'], keyBase: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let k = 0
  for (const m of text.matchAll(INLINE_RE)) {
    const tok = m[0]
    const at = m.index ?? 0
    if (at > last) out.push(text.slice(last, at))
    last = at + tok.length
    const key = `${keyBase}-${k++}`
    if (tok.startsWith('[[')) {
      const title = tok.slice(2, -2)
      const c = resolve?.(title)
      out.push(
        c?.href ? (
          <a key={key} className="md-cite" href={c.href}>
            {c.title}
          </a>
        ) : (
          <span key={key} className="md-cite md-cite--missing">
            {title}
          </span>
        ),
      )
    } else if (tok.startsWith('**') || tok.startsWith('__')) out.push(<strong key={key}>{inline(tok.slice(2, -2), resolve, key)}</strong>)
    else if (tok.startsWith('~~')) out.push(<s key={key}>{inline(tok.slice(2, -2), resolve, key)}</s>)
    else if (tok.startsWith('`')) out.push(<code key={key}>{tok.slice(1, -1)}</code>)
    else if (tok.startsWith('[')) {
      const lm = tok.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/)
      const href = lm?.[2] ?? ''
      const safe = /^(https?:|mailto:|#)/i.test(href)
      out.push(
        safe ? (
          <a key={key} href={href} target={href.startsWith('#') ? undefined : '_blank'} rel="noreferrer">
            {lm?.[1]}
          </a>
        ) : (
          <span key={key}>{lm?.[1]}</span>
        ),
      )
    } else out.push(<em key={key}>{inline(tok.slice(1, -1), resolve, key)}</em>)
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

function withBreaks(text: string, resolve: Props['resolveCitation'], key: string): ReactNode {
  const lines = text.split('\n')
  return lines.map((l, i) => (
    <Fragment key={i}>
      {inline(l, resolve, `${key}-${i}`)}
      {i < lines.length - 1 && <br />}
    </Fragment>
  ))
}

function renderList(items: ListItem[], resolve: Props['resolveCitation'], key: string): ReactNode {
  // Build a nested tree from flat depth-annotated items.
  type Node = { item: ListItem; children: ListItem[] }
  const nodes: Node[] = []
  const base = Math.min(...items.map((i) => i.depth))
  for (const it of items) {
    if (it.depth > base && nodes.length) nodes[nodes.length - 1].children.push(it)
    else nodes.push({ item: it, children: [] })
  }
  const ordered = nodes[0]?.item.ordered
  const isTask = nodes.some((n) => n.item.task !== null)
  const Tag = ordered ? 'ol' : 'ul'
  return (
    <Tag key={key} className={isTask ? 'md-tasks' : undefined} start={ordered && nodes[0].item.num !== 1 ? nodes[0].item.num : undefined}>
      {nodes.map((n, i) => (
        <li key={i} data-checked={n.item.task === null ? undefined : String(n.item.task)}>
          {n.item.task !== null && <span className="md-check" aria-hidden />}
          <span>{inline(n.item.text, resolve, `${key}-${i}`)}</span>
          {n.children.length > 0 && renderList(n.children, resolve, `${key}-${i}-c`)}
        </li>
      ))}
    </Tag>
  )
}

export const MarkdownLite = memo(function MarkdownLite({ source, resolveCitation, className }: Props) {
  const blocks = parse(source)
  return (
    <div className={`md-lite ${className ?? ''}`}>
      {blocks.map((b, i) => {
        const key = `b${i}`
        switch (b.t) {
          case 'h': {
            const H = `h${b.level + 1}` as 'h2' | 'h3' | 'h4'
            return <H key={key}>{inline(b.text, resolveCitation, key)}</H>
          }
          case 'p':
            return <p key={key}>{withBreaks(b.text, resolveCitation, key)}</p>
          case 'quote':
            return <blockquote key={key}>{withBreaks(b.text, resolveCitation, key)}</blockquote>
          case 'code':
            return (
              <pre key={key} data-lang={b.lang || undefined}>
                <code>{b.text}</code>
              </pre>
            )
          case 'hr':
            return <hr key={key} />
          case 'list':
            return renderList(b.items, resolveCitation, key)
          case 'table':
            return (
              <div key={key} className="md-table">
                <table>
                  <tbody>
                    {b.rows.map((r, ri) => (
                      <tr key={ri}>
                        {r.map((c, ci) => {
                          const Cell = ri === 0 ? 'th' : 'td'
                          return <Cell key={ci}>{inline(c, resolveCitation, `${key}-${ri}-${ci}`)}</Cell>
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
        }
        return null
      })}
    </div>
  )
})
