/**
 * Coding pipeline — what a document stage's output becomes besides its section (pure, no store):
 *  - 'pages': the document split at its `##` headings (outside code fences) → one page per section
 *  - 'stories': the stories in the document's last fenced json block → tasks of a new coding project
 * ('testcases' lives in tasks.ts parseCases; 'review' is the document itself.)
 */

export interface DocSection {
  title: string
  body: string
}

/** The intro (before the first `## `) and the `## ` sections of a Markdown document; `#` / `###` stay inside. */
export function splitSections(md: string): { intro: string; sections: DocSection[] } {
  const lines = md.replace(/\r\n?/g, '\n').split('\n')
  const intro: string[] = []
  const sections: Array<{ title: string; lines: string[] }> = []
  let fence: string | null = null
  for (const line of lines) {
    const f = /^\s{0,3}(`{3,}|~{3,})/.exec(line)
    if (f) {
      if (!fence) fence = f[1]!
      else if (f[1]![0] === fence[0] && f[1]!.length >= fence.length && !line.trim().slice(f[1]!.length).trim()) fence = null
    }
    const h = !fence && !f ? /^##\s+(.+?)\s*#*\s*$/.exec(line) : null
    if (h) {
      sections.push({ title: h[1]!.replace(/[*_`]/g, '').trim().slice(0, 200), lines: [] })
      continue
    }
    if (sections.length) sections[sections.length - 1]!.lines.push(line)
    else intro.push(line)
  }
  return {
    intro: intro.join('\n').trim(),
    sections: sections.filter((s) => s.title).map((s) => ({ title: s.title, body: s.lines.join('\n').trim() })),
  }
}

export interface Story {
  title: string
  /** the story ("As a … I want … so that …") and its notes */
  text: string
  criteria: string[]
  priority: 'high' | 'medium' | 'low'
}

const str = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : typeof v === 'number' ? String(v) : '')

/**
 * The stories a document hands in: its last fenced json block — an array, or { project?, stories: [...] } — each
 * story sanitized (≤ 100); `rest` = the document without that block. No block / no stories: none, the text as is.
 */
export function parseStories(md: string): { project: string; stories: Story[]; rest: string } {
  const fences = [...md.matchAll(/```json\s*\n([\s\S]*?)\n```/g)]
  const last = fences[fences.length - 1]
  if (!last) return { project: '', stories: [], rest: md }
  let raw: unknown
  try {
    raw = JSON.parse(last[1]!)
  } catch {
    return { project: '', stories: [], rest: md }
  }
  const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null
  const list = Array.isArray(raw) ? raw : Array.isArray(obj?.stories) ? (obj!.stories as unknown[]) : []
  const stories: Story[] = []
  for (const item of list.slice(0, 100)) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const title = str(o.title ?? o.name, 200)
    if (!title) continue
    const crit = o.criteria ?? o.acceptance ?? o.acceptanceCriteria
    const criteria = (Array.isArray(crit) ? crit.map((c) => str(c, 400)) : str(crit, 4000).split(/\n+/).map((c) => c.replace(/^[-*\d.)\s]+/, '').trim())).filter(Boolean).slice(0, 30)
    const prio = String(o.priority ?? '').toLowerCase()
    stories.push({
      title,
      text: [str(o.story ?? o.text ?? o.description, 4000), str(o.notes, 4000)].filter(Boolean).join('\n\n'),
      criteria,
      priority: prio.startsWith('h') || prio === 'p1' || prio === 'must' ? 'high' : prio.startsWith('l') || prio === 'p3' || prio === 'could' ? 'low' : 'medium',
    })
  }
  const rest = stories.length ? (md.slice(0, last.index) + md.slice(last.index! + last[0].length)).trim() : md
  return { project: str(obj?.project, 120), stories, rest }
}
