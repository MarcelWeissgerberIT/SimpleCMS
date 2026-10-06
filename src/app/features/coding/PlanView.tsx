/**
 * The plan of a task as Claude handed it in — a small Markdown reader (headings, lists, code, bold, inline
 * code, paragraphs). Plain text only: no HTML, no links followed. The same plan is in the task page.
 */
import type { ReactNode } from 'react'

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(`[^`]+`|\*\*[^*]+\*\*)/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const tok = m[0]
    out.push(tok.startsWith('`') ? <code key={`${key}c${i++}`}>{tok.slice(1, -1)}</code> : <strong key={`${key}b${i++}`}>{tok.slice(2, -2)}</strong>)
    last = m.index + tok.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

interface List {
  ordered: boolean
  items: string[]
}

export function PlanView({ markdown }: { markdown: string }) {
  const blocks: ReactNode[] = []
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const st: { list: List | null } = { list: null }
  let para: string[] = []
  const flushPara = () => {
    if (para.length) blocks.push(<p key={`p${blocks.length}`}>{inline(para.join(' '), `p${blocks.length}`)}</p>)
    para = []
  }
  const flushList = () => {
    const l = st.list
    if (l) {
      const k = `l${blocks.length}`
      const items = l.items.map((it, i) => <li key={i}>{inline(it, `${k}-${i}`)}</li>)
      blocks.push(l.ordered ? <ol key={k}>{items}</ol> : <ul key={k}>{items}</ul>)
    }
    st.list = null
  }
  const flush = () => {
    flushPara()
    flushList()
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (line.startsWith('```')) {
      flush()
      const code: string[] = []
      for (i++; i < lines.length && !lines[i]!.startsWith('```'); i++) code.push(lines[i]!)
      blocks.push(<pre key={`c${blocks.length}`}>{code.join('\n')}</pre>)
      continue
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line)
    if (h) {
      flush()
      blocks.push(
        <h4 key={`h${blocks.length}`} data-level={h[1]!.length}>
          {inline(h[2]!, `h${blocks.length}`)}
        </h4>,
      )
      continue
    }
    const li = /^\s*(?:([-*+])|(\d+)[.)])\s+(?:\[[ xX]\]\s+)?(.*)$/.exec(line)
    if (li) {
      flushPara()
      const ordered = !!li[2]
      const cur = st.list
      if (!cur || cur.ordered !== ordered) {
        flushList()
        st.list = { ordered, items: [li[3]!] }
      } else cur.items.push(li[3]!)
      continue
    }
    if (!line.trim()) {
      flush()
      continue
    }
    const cur = st.list
    if (cur) {
      // a continuation line of the last item
      cur.items[cur.items.length - 1] += ` ${line.trim()}`
      continue
    }
    para.push(line.trim())
  }
  flush()
  return <div className="ctk-plan">{blocks}</div>
}
