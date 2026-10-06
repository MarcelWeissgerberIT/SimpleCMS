/**
 * One Script editor — snippets: small pieces of code with tab stops, offered by the completion list at
 * the start of a statement (`for`, `if`, `fn` …). A body marks its stops as `${1:placeholder}`, `${2}`
 * and the end as `$0`; newlines take the line's indentation, a tab is one level (two spaces).
 * Placeholder texts come in the person's language (`ph(key)`).
 */
export interface SnippetDef {
  id: string
  /** what is typed to find it */
  trigger: string
  /** the body (placeholders: ${n:text}, ${n}, $0) — `ph` translates a placeholder text */
  body: (ph: (key: string) => string) => string
}

export const SNIPPETS: SnippetDef[] = [
  { id: 'for', trigger: 'for', body: (ph) => `for \${1:${ph('item')}} in \${2:${ph('list')}} {\n\t$0\n}` },
  { id: 'if', trigger: 'if', body: (ph) => `if \${1:${ph('condition')}} {\n\t$0\n}` },
  { id: 'ifelse', trigger: 'ifelse', body: (ph) => `if \${1:${ph('condition')}} {\n\t\${2}\n} else {\n\t$0\n}` },
  { id: 'fn', trigger: 'fn', body: (ph) => `fn \${1:${ph('name')}}(\${2:x}) {\n\treturn \${3:x}\n}$0` },
  { id: 'let', trigger: 'let', body: (ph) => `let \${1:${ph('name')}} = \${2:${ph('value')}}$0` },
  { id: 'query', trigger: 'query', body: (ph) => `db(@\${1}).where(\${2:${ph('condition')}}).sort(\${3:${ph('property')}}).limit(\${4:10})$0` },
  { id: 'each', trigger: 'each', body: (ph) => `for t in db(@\${1}).where(\${2:${ph('condition')}}).rows {\n\tt.set(\${3:${ph('property')}}: \${4:${ph('value')}})$0\n}` },
  { id: 'mail', trigger: 'mail', body: (ph) => `mail.send(to: "\${1:team@example.com}", subject: "\${2:${ph('subject')}}", body: \${3:"${ph('text')}"})$0` },
  { id: 'confirm', trigger: 'confirm', body: (ph) => `if confirm("\${1:${ph('sure')}}") {\n\t$0\n}` },
  { id: 'choose', trigger: 'choose', body: (ph) => `let \${1:${ph('picked')}} = choose("\${2:${ph('which')}}", \${3:${ph('list')}})$0` },
  { id: 'ask', trigger: 'ask', body: (ph) => `let \${1:${ph('answer')}} = ask("\${2:${ph('question')}}", default: "\${3}")$0` },
  { id: 'notify', trigger: 'notify', body: (ph) => `notify("\${1:${ph('done')}}")$0` },
  { id: 'claude', trigger: 'claude', body: (ph) => `let \${1:${ph('answer')}} = claude("\${2:${ph('prompt')}}", \${3:${ph('text')}})$0` },
]

export interface Expanded {
  text: string
  /** tab stops (offsets in `text`), in the order Tab visits them */
  stops: Array<{ n: number; start: number; end: number }>
  /** where the caret ends ($0; the end when there is none) */
  end: number
}

/**
 * Turn a body into the text to insert at a line indented by `indent`: placeholders become their text,
 * the stops are recorded (1, 2, … then 0).
 */
export function expandSnippet(body: string, indent: string): Expanded {
  let text = ''
  const raw: Array<{ n: number; start: number; end: number }> = []
  let end = -1
  for (let i = 0; i < body.length; i++) {
    const c = body[i]
    if (c === '\n') {
      text += `\n${indent}`
      continue
    }
    if (c === '\t') {
      text += '  '
      continue
    }
    if (c === '$') {
      const m = /^\$\{(\d+)(?::([^}]*))?\}|^\$(\d+)/.exec(body.slice(i))
      if (m) {
        const n = Number(m[1] ?? m[3])
        const ph = m[2] ?? ''
        if (n === 0) end = text.length
        else raw.push({ n, start: text.length, end: text.length + ph.length })
        text += ph
        i += m[0].length - 1
        continue
      }
    }
    text += c
  }
  const stops = raw.sort((a, b) => a.n - b.n || a.start - b.start)
  return { text, stops, end: end < 0 ? text.length : end }
}

/**
 * A snippet session after an insert: the stops (absolute offsets) move with every edit; Tab goes to the
 * next one, Shift+Tab back, after the last one the caret goes to $0 and the session ends.
 */
export interface Session {
  stops: Array<{ n: number; start: number; end: number }>
  end: number
  /** index of the stop the caret is in */
  at: number
}

/** Move the session's places for an edit that replaced [from, to) with `len` characters. null = it no longer fits. */
export function shiftSession(s: Session, from: number, to: number, len: number): Session | null {
  const delta = len - (to - from)
  const stops: Session['stops'] = []
  for (const st of s.stops) {
    if (to <= st.start && from < st.start) stops.push({ ...st, start: st.start + delta, end: st.end + delta })
    else if (from >= st.start && to <= st.end) stops.push({ ...st, end: st.end + delta })
    else if (from >= st.end) stops.push(st)
    else return null
  }
  const end = s.end >= to ? s.end + delta : s.end > from ? from + len : s.end
  return { stops, end, at: s.at }
}

/** The edit between two versions of a text: [from, to) of the old text became `len` new characters. */
export function diffEdit(prev: string, next: string): { from: number; to: number; len: number } {
  let a = 0
  const max = Math.min(prev.length, next.length)
  while (a < max && prev[a] === next[a]) a++
  let b = 0
  while (b < max - a && prev[prev.length - 1 - b] === next[next.length - 1 - b]) b++
  return { from: a, to: prev.length - b, len: next.length - b - a }
}
