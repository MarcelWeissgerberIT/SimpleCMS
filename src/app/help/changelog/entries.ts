/**
 * "What's new" — the changelog as data. Pure (no DOM, no Node APIs, no app imports): shared by the Help
 * panel (help/content.ts feeds it the bundled files) and the public /help/changelog/ pages built by
 * src/help-site. Imports carry a .js specifier, the form Vite's config loader resolves (see library.ts).
 *
 * An entry is a Markdown twin per language, src/app/help/changelog/{en,de}/<yyyy-mm-dd>-<slug>.md:
 *
 *   ---
 *   id: 2026-10-05-ai-terminal               (the file name; the same in both languages)
 *   date: 2026-10-05
 *   order: 1                                 (rank within that day, 1 = newest; default 99)
 *   title: The AI terminal
 *   summary: One line under the title.
 *   image: assets/shots/changelog/ai-terminal.webp   (under public/, no leading slash)
 *   alt: What the screenshot shows.          (optional; default: the title)
 *   help: agent, ai-menu                     (optional: related article ids)
 *   try: terminal                            (optional: one of CHANGELOG_TRIES)
 *   ---
 *
 * The body uses the articles' Markdown subset (markdown.ts): 2–6 short paragraphs or bullets.
 */
import { blocksToPlain, parseBlocks, parseFrontMatter, type Block } from '../markdown.js'

export type ChangelogLang = 'en' | 'de'
export const CHANGELOG_LANGS: ChangelogLang[] = ['en', 'de']

/**
 * What an entry's "Try it" key may do — a fixed allow-list, never code from the Markdown (the keys of
 * "What can One do?" use the same list): terminal (⌘J), Settings → Claude AI / Agents · MCP / Mail / Sync,
 * the Agents page, "Ask the help", ⌘K, Scripts, Import, the Inbox, the open page's history / Share,
 * "What can One do?", the guided tour, and — on the tour's practice page — the slash menu, the AI menu,
 * Transform into; a database, its commands, a spreadsheet, a database's automations; the coding pipeline (#/coding).
 */
export const CHANGELOG_TRIES = [
  'terminal',
  'settings-ai',
  'settings-mcp',
  'settings-mail',
  'settings-sync',
  'agents',
  'ask',
  'palette',
  'scripts',
  'import',
  'inbox',
  'history',
  'share',
  'discover',
  'tour',
  'slash',
  'ai-menu',
  'transform',
  'database',
  'commands',
  'sheet',
  'automations',
  'coding',
] as const
export type ChangelogTry = (typeof CHANGELOG_TRIES)[number]

/** Where the screenshots live, under public/. */
export const CHANGELOG_IMAGE_DIR = 'assets/shots/changelog'

/** The public changelog's id in help paths: help/changelog/, help/de/changelog/ — no article may use it. */
export const CHANGELOG_PATH_ID = 'changelog'

export interface ChangelogEntry {
  /** "2026-10-05-ai-terminal" — the file name */
  id: string
  lang: ChangelogLang
  /** "2026-10-05" */
  date: string
  /** rank within its day (1 = newest) */
  order: number
  title: string
  summary: string
  /** "assets/shots/changelog/ai-terminal.webp" (resolve with the Vite base) */
  image: string
  alt: string
  /** related article ids */
  help: string[]
  try: ChangelogTry | null
  blocks: Block[]
  /** body as plain text */
  plain: string
  /** the Markdown body as written */
  source: string
}

export type Changelog = Record<ChangelogLang, ChangelogEntry[]>

export interface ChangelogFile {
  lang: ChangelogLang
  /** file name without .md */
  id: string
  raw: string
}

const FILE_ID = /^(\d{4}-\d{2}-\d{2})-[a-z0-9-]+$/

const list = (v: string | undefined) =>
  (v ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)

const isTry = (v: string): v is ChangelogTry => (CHANGELOG_TRIES as readonly string[]).includes(v)

/** Parse one entry file; problems go to `warn`. */
export function parseEntry(f: ChangelogFile, warn: (msg: string) => void = () => {}): ChangelogEntry {
  const { meta, body } = parseFrontMatter(f.raw)
  const where = `changelog: ${f.lang}/${f.id}.md`
  const fileDate = FILE_ID.exec(f.id)?.[1] ?? ''
  if (!fileDate) warn(`${where}: the file name must be <yyyy-mm-dd>-<slug>`)
  if (meta.id && meta.id !== f.id) warn(`${where} declares id "${meta.id}"`)
  const date = /^\d{4}-\d{2}-\d{2}$/.test(meta.date ?? '') ? meta.date : fileDate
  if (meta.date !== fileDate) warn(`${where}: date "${meta.date ?? ''}" does not match the file name`)
  for (const key of ['title', 'summary', 'image'] as const) if (!meta[key]) warn(`${where} has no ${key}`)
  const image = (meta.image ?? '').replace(/^\/+/, '')
  if (image && !image.startsWith(`${CHANGELOG_IMAGE_DIR}/`)) warn(`${where}: the image belongs in ${CHANGELOG_IMAGE_DIR}/`)
  const tryValue = (meta.try ?? '').trim()
  if (tryValue && !isTry(tryValue)) warn(`${where}: unknown try "${tryValue}" (allowed: ${CHANGELOG_TRIES.join(', ')})`)
  const blocks = parseBlocks(body)
  return {
    id: f.id,
    lang: f.lang,
    date,
    order: Number(meta.order) || 99,
    title: meta.title || f.id,
    summary: meta.summary || '',
    image,
    alt: meta.alt || meta.title || '',
    help: list(meta.help),
    try: tryValue && isTry(tryValue) ? tryValue : null,
    blocks,
    plain: blocksToPlain(blocks),
    source: body.trim(),
  }
}

/** Newest first: by date, then by `order` within a day. */
export function compareEntries(a: Pick<ChangelogEntry, 'date' | 'order' | 'id'>, b: Pick<ChangelogEntry, 'date' | 'order' | 'id'>): number {
  return b.date.localeCompare(a.date) || a.order - b.order || a.id.localeCompare(b.id)
}

/**
 * Parse and sort every entry. `warn` gets small problems; `fail` gets what must stop a build — an entry
 * without its twin in the other language. `articleIds`: ids of the help articles (for `help:` checks).
 */
export function buildChangelog(files: ChangelogFile[], warn: (msg: string) => void = () => {}, fail: (msg: string) => void = warn, articleIds?: Set<string>): Changelog {
  const log: Changelog = { en: [], de: [] }
  for (const f of files) log[f.lang].push(parseEntry(f, warn))
  for (const lang of CHANGELOG_LANGS) {
    log[lang].sort(compareEntries)
    if (!articleIds) continue
    for (const e of log[lang]) {
      for (const id of e.help) if (!articleIds.has(id)) warn(`changelog: ${lang}/${e.id}.md relates to unknown article "${id}"`)
      for (const m of e.source.matchAll(/\]\(help:([a-z0-9-]+)\)/g)) if (!articleIds.has(m[1])) warn(`changelog: ${lang}/${e.id}.md links to unknown article "${m[1]}"`)
    }
  }
  const en = new Map(log.en.map((e) => [e.id, e]))
  const de = new Map(log.de.map((e) => [e.id, e]))
  for (const id of en.keys()) if (!de.has(id)) fail(`changelog: "${id}" has no German version (src/app/help/changelog/de/${id}.md)`)
  for (const id of de.keys()) if (!en.has(id)) fail(`changelog: "${id}" has no English version (src/app/help/changelog/en/${id}.md)`)
  for (const [id, e] of en) {
    const twin = de.get(id)
    if (!twin) continue
    if (twin.image !== e.image) warn(`changelog: "${id}" shows another image in German`)
    if (twin.date !== e.date || twin.order !== e.order) warn(`changelog: "${id}" has another date or order in German`)
  }
  return log
}

/** The id of the newest entry (both languages share ids), or null. */
export const newestEntryId = (log: Changelog): string | null => log.en[0]?.id ?? log.de[0]?.id ?? null

export function findEntry(log: Changelog, lang: ChangelogLang, id: string): ChangelogEntry | undefined {
  return log[lang].find((e) => e.id === id) ?? log[lang === 'de' ? 'en' : 'de'].find((e) => e.id === id)
}

/** The newer and the older neighbour of an entry. */
export function entryNeighbours(log: Changelog, lang: ChangelogLang, id: string): { newer?: ChangelogEntry; older?: ChangelogEntry } {
  const list = log[lang]
  const i = list.findIndex((e) => e.id === id)
  return i < 0 ? {} : { newer: list[i - 1], older: list[i + 1] }
}

const MONTHS: Record<ChangelogLang, string[]> = {
  en: ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'],
  de: ['JAN', 'FEB', 'MÄR', 'APR', 'MAI', 'JUN', 'JUL', 'AUG', 'SEP', 'OKT', 'NOV', 'DEZ'],
}

/** "2026-10-05" → "05 OCT 2026" / "05 OKT 2026" (the mono date label). */
export function entryDateLabel(date: string, lang: ChangelogLang): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!m) return date
  return `${m[3]} ${MONTHS[lang][Number(m[2]) - 1] ?? m[2]} ${m[1]}`
}
