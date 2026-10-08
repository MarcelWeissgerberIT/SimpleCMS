/**
 * Code block languages: the editor's lowlight instance (highlight.js "common" grammars) and the list the language
 * menu offers. Other areas add a language at boot with registerCodeLanguage (editor/index.ts) — One Script does
 * (main.tsx) — so the list is data, not a switch in the view. A language is stored as the code block's `language`
 * attribute (its id); aliases (js, ts, md …) are read back as the id.
 */
import { createLowlight, common, type LanguageFn } from 'lowlight'

export const lowlight = createLowlight(common)

export interface CodeLanguage {
  /** the stored value (a lowlight grammar name); '' = plain text */
  id: string
  label: string
  aliases?: string[]
}

const BUILT_IN: CodeLanguage[] = [
  { id: '', label: 'Plain text' },
  { id: 'bash', label: 'Bash', aliases: ['sh', 'zsh'] },
  { id: 'c', label: 'C' },
  { id: 'cpp', label: 'C++', aliases: ['c++'] },
  { id: 'csharp', label: 'C#', aliases: ['cs'] },
  { id: 'css', label: 'CSS' },
  { id: 'diff', label: 'Diff' },
  { id: 'go', label: 'Go', aliases: ['golang'] },
  { id: 'graphql', label: 'GraphQL' },
  { id: 'xml', label: 'HTML / XML', aliases: ['html'] },
  { id: 'ini', label: 'INI / TOML', aliases: ['toml'] },
  { id: 'java', label: 'Java' },
  { id: 'javascript', label: 'JavaScript', aliases: ['js', 'jsx'] },
  { id: 'json', label: 'JSON' },
  { id: 'kotlin', label: 'Kotlin' },
  { id: 'less', label: 'Less' },
  { id: 'lua', label: 'Lua' },
  { id: 'makefile', label: 'Makefile' },
  { id: 'markdown', label: 'Markdown', aliases: ['md'] },
  { id: 'objectivec', label: 'Objective-C' },
  { id: 'perl', label: 'Perl' },
  { id: 'php', label: 'PHP' },
  { id: 'python', label: 'Python', aliases: ['py'] },
  { id: 'r', label: 'R' },
  { id: 'ruby', label: 'Ruby', aliases: ['rb'] },
  { id: 'rust', label: 'Rust', aliases: ['rs'] },
  { id: 'scss', label: 'SCSS' },
  { id: 'shell', label: 'Shell session' },
  { id: 'sql', label: 'SQL' },
  { id: 'swift', label: 'Swift' },
  { id: 'typescript', label: 'TypeScript', aliases: ['ts', 'tsx'] },
  { id: 'yaml', label: 'YAML', aliases: ['yml'] },
]

const extra: CodeLanguage[] = []
const listeners = new Set<() => void>()
let cached: CodeLanguage[] | null = null

/** Adds a language (its grammar goes into the editor's lowlight; the menu lists it). Registering an id again replaces it. */
export function registerCodeLanguage(lang: CodeLanguage & { grammar: LanguageFn }): void {
  const { grammar, ...entry } = lang
  lowlight.register({ [entry.id]: grammar })
  if (entry.aliases?.length) lowlight.registerAlias({ [entry.id]: entry.aliases })
  const at = extra.findIndex((l) => l.id === entry.id)
  if (at >= 0) extra[at] = entry
  else extra.push(entry)
  cached = null
  for (const fn of listeners) fn()
}

export const onCodeLanguages = (fn: () => void) => {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}

/** Plain text first, then every language by its label (the same array until a language is added). */
export function codeLanguages(): CodeLanguage[] {
  if (cached) return cached
  const [plain, ...rest] = BUILT_IN
  cached = [plain, ...[...rest, ...extra.filter((e) => !rest.some((b) => b.id === e.id))].sort((a, b) => a.label.localeCompare(b.label))]
  return cached
}

/** The id of a stored value or alias ("js" → "javascript"); '' for plain text. */
export function languageId(lang: string | null | undefined): string {
  const v = (lang ?? '').trim().toLowerCase()
  if (!v || v === 'plaintext' || v === 'text' || v === 'plain') return ''
  for (const l of [...BUILT_IN, ...extra]) if (l.id === v || l.aliases?.includes(v)) return l.id
  return v
}

export function languageLabel(lang: string | null | undefined, plain = 'Plain text'): string {
  const id = languageId(lang)
  if (!id) return plain
  return [...BUILT_IN, ...extra].find((l) => l.id === id)?.label ?? lang ?? plain
}
