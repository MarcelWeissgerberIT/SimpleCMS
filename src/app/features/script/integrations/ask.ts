/**
 * "Ask Claude" in the script editor and the query builder: a sentence → One Script code. Claude gets
 * the language reference and the workspace's databases (names, properties, options — never page
 * content or rows), and answers with code only. The code is parsed before anyone sees it; a draft that
 * does not parse is sent back once with the parser's error. Nothing is run or saved here: the person
 * looks at the draft and accepts it (or not).
 */
import { useWorkspace } from '../../../store/store'
import { inTemplate, isEffectivelyTrashed } from '../../../store/selectors'
import type { Database, Page } from '../../../store/types'
import { SCRIPT_REFERENCE } from '../reference'
import { syntaxErrorText } from './tools'

const DBS_MAX = 30
const OPTIONS_MAX = 12

const refToken = (p: Page) => `@[${(p.title.trim() || 'Untitled').replace(/[\]\\]/g, (c) => `\\${c}`)}](p:${p.id})`

/** The workspace's databases and people for a prompt: names, property types and options. */
export function workspaceSketch(): string {
  const { pages, databases, people } = useWorkspace.getState()
  const dbs = Object.values(databases)
    .map((db) => ({ db, page: pages[db.id] }))
    .filter((x): x is { db: Database; page: Page } => !!x.page && !x.page.trashed && !isEffectivelyTrashed(pages, x.page.id) && !inTemplate(pages, x.page.id))
    .sort((a, b) => b.page.updatedAt - a.page.updatedAt)
    .slice(0, DBS_MAX)
  const lines = dbs.map(({ db, page }) => {
    const props = db.properties
      .map((p) => {
        const opts = p.options?.length ? `: ${p.options.slice(0, OPTIONS_MAX).map((o) => o.name).join(' | ')}${p.options.length > OPTIONS_MAX ? ' | …' : ''}` : ''
        return `${p.name} (${p.type}${opts})`
      })
      .join('; ')
    return `- ${refToken(page)} — ${props}`
  })
  const who = people.slice(0, 30).map((p) => p.name).filter(Boolean)
  return [`Databases (reference them with the token shown):`, ...(lines.length ? lines : ['- none yet']), ...(who.length ? [`People: ${who.join(', ')}`] : [])].join('\n')
}

const SYSTEM = (kind: 'script' | 'query') => `You write One Script code for the person's One workspace (a local-first notes app with pages and databases).
Reply with the code only, in one fenced block (\`\`\`one … \`\`\`), nothing before or after it. Short comments (#) inside the code may explain the steps, in the language of the request.
${kind === 'query' ? 'Write a QUERY: read-only, ideally one expression like db(@[…](p:…)).where(…).sort(…).limit(…).select(…) — no set, add, append, create, trash, effects or dialogs.' : 'Write a SCRIPT: it may read and change the workspace and use dialogs and effects; prefer a dry-run-friendly script that says what it did with notify(…).'}
Use only the databases, properties and option names listed below, spelled exactly; put property names with spaces in backticks. Never invent ids.

${SCRIPT_REFERENCE}`

/** The code in Claude's answer (the fenced block, else the whole text). */
export function codeOf(answer: string): string {
  const m = /```[a-z]*[ \t]*\n([\s\S]*?)```/i.exec(answer)
  return (m ? m[1] : answer).replace(/\s+$/, '') + '\n'
}

export interface Draft {
  code: string
  /** the parser's complaint when even the second answer did not parse (the draft cannot be used) */
  error: string | null
}

/** Ask Claude for code (one retry when the first answer does not parse). */
export async function draftWithClaude(input: { task: string; kind: 'script' | 'query'; code: string; signal: AbortSignal }): Promise<Draft> {
  const { streamCompletion } = await import('../../ai/client')
  const current = input.code.trim() ? `\n\nThe ${input.kind} so far (change it as asked, or replace it):\n\`\`\`one\n${input.code.trim()}\n\`\`\`` : ''
  const base = `${workspaceSketch()}${current}\n\nRequest: ${input.task.trim()}`
  let answer = await streamCompletion({ system: SYSTEM(input.kind), prompt: base, signal: input.signal, mcp: false })
  let code = codeOf(answer)
  let error = await syntaxErrorText(code)
  if (!error) return { code, error: null }
  answer = await streamCompletion({ system: SYSTEM(input.kind), prompt: `${base}\n\nYour previous answer did not parse:\n\`\`\`one\n${code.trim()}\n\`\`\`\nParser: ${error}\nAnswer again with corrected code only.`, signal: input.signal, mcp: false })
  code = codeOf(answer)
  error = await syntaxErrorText(code)
  return { code, error }
}
