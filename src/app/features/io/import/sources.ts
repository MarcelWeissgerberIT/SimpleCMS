/**
 * Which importer handles what: detect the source of a set of files and build ONE ImportPlan.
 *   .enex                       → Evernote notebooks (enex.ts)
 *   Trello board JSON           → database with a Board view (trello.ts)
 *   a vault (.obsidian/ or [[wiki links]]) → Obsidian (obsidian.ts)
 *   everything else             → Notion export / Markdown / CSV / HTML (plan.ts)
 * Mixed drops (e.g. an .enex next to a Markdown folder) are planned separately and merged.
 */
import { buildPlan, decodeText, extname, type ImportEntry, type ImportPlan, type PlanNode } from './plan'
import { buildEnexPlan, isEnexPath, type EnexOptions } from './enex'
import { buildObsidianPlan, hasWikiLinks, isObsidianVault } from './obsidian'
import { buildTrelloPlan, isTrelloBoard, type TrelloBoard, type TrelloLabels } from './trello'
import type { ReportItem } from './report'

/** What the person picked in the dialog ('auto' = dropped / "Choose files"). */
export type SourceMode = 'auto' | 'notion' | 'obsidian' | 'evernote' | 'trello' | 'html' | 'markdown' | 'csv' | 'backup' | 'pptx' | 'design'

export interface SourceOptions {
  mode: SourceMode
  looseTitle: string
  /** name of the picked folder / single file (vault name fallback) */
  name?: string
  enex: EnexOptions['labels']
  trello: TrelloLabels
  /** Trello boards already parsed by the dialog (top-level .json files) */
  boards?: TrelloBoard[]
  onProgress?: (done: number, total: number) => void
}

/** Parse a JSON text as a Trello board export (null if it is something else). */
export function parseTrello(text: string): TrelloBoard | null {
  if (!text.trimStart().startsWith('{') || !text.includes('"cards"')) return null
  try {
    const o: unknown = JSON.parse(text)
    return isTrelloBoard(o) ? o : null
  } catch {
    return null
  }
}

export async function planImport(input: ImportEntry[], opts: SourceOptions): Promise<ImportPlan> {
  const plans: ImportPlan[] = []
  const report: ReportItem[] = []

  // Evernote
  const enex = input.filter((e) => isEnexPath(e.path))
  if (enex.length) {
    plans.push(await buildEnexPlan(enex.map((e) => ({ name: e.path.split('/').pop() ?? e.path, text: decodeText(e.data) })), { labels: opts.enex, onProgress: opts.onProgress }))
  }

  // Trello (picked JSON files + JSON inside archives)
  const boards = [...(opts.boards ?? [])]
  let rest = input.filter((e) => !isEnexPath(e.path))
  rest = rest.filter((e) => {
    if (extname(e.path) !== 'json' || /(^|\/)\./.test(e.path)) return true
    const board = parseTrello(decodeText(e.data))
    if (board) boards.push(board)
    // any other JSON stays an attachment
    return !board
  })
  if (boards.length) plans.push(buildTrelloPlan(boards, opts.trello))

  // Obsidian / Notion / Markdown / CSV / HTML
  if (rest.length) {
    const forceGeneric = opts.mode === 'notion' || opts.mode === 'markdown' || opts.mode === 'csv'
    const vault = opts.mode === 'obsidian' || (!forceGeneric && (isObsidianVault(rest) || hasWikiLinks(rest)))
    if (vault) plans.push(await buildObsidianPlan(rest, { looseTitle: opts.looseTitle, name: opts.name, onProgress: opts.onProgress }))
    else {
      const plan = buildPlan(rest, { looseTitle: opts.looseTitle })
      const content = plan.nodes.filter((n) => n.kind !== 'folder')
      const html = content.some((n) => n.format === 'html')
      const md = content.some((n) => n.format !== 'html')
      const tables = content.length > 0 && content.every((n) => n.kind === 'database' || n.kind === 'row')
      if (html && plan.isNotion) report.push({ code: 'notionHtml', detail: opts.name ?? 'HTML' })
      plans.push({ ...plan, source: plan.isNotion ? 'notion' : tables ? 'csv' : html && !md ? 'html' : 'markdown' })
    }
  }

  const merged = plans.length === 1 ? plans[0] : mergePlans(plans.filter((p) => p.nodes.length))
  return { ...merged, report: [...(merged.report ?? []), ...report] }
}

/**
 * Several plans → one. Every key and path gets a per-plan prefix ("@1/…"), so keys never clash;
 * relative links inside a plan keep working because its whole tree moves together.
 */
export function mergePlans(plans: ImportPlan[]): ImportPlan {
  if (plans.length === 1) return plans[0]
  const out: ImportPlan = { nodes: [], files: new Map(), pathKeys: new Map(), roots: [], isNotion: false, warnings: [], source: 'mixed', people: [], report: [] }
  plans.forEach((p, i) => {
    const pre = (s: string) => `@${i}/${s}`
    const opt = (s: string | null | undefined) => (s ? pre(s) : (s as null))
    for (const n of p.nodes) {
      const next: PlanNode = {
        ...n,
        key: pre(n.key),
        parentKey: opt(n.parentKey),
        dir: n.dir ? pre(n.dir) : `@${i}`,
        attachments: n.attachments.map(pre),
        ...(n.dbKey ? { dbKey: pre(n.dbKey) } : {}),
        ...(n.csvDir !== undefined ? { csvDir: n.csvDir ? pre(n.csvDir) : `@${i}` } : {}),
        ...(n.embeds ? { embeds: n.embeds.map(pre) } : {}),
      }
      out.nodes.push(next)
    }
    for (const [k, v] of p.files) out.files.set(pre(k), v)
    for (const [k, v] of p.pathKeys) out.pathKeys.set(pre(k), pre(v))
    out.roots.push(...p.roots.map(pre))
    out.isNotion ||= p.isNotion
    out.warnings.push(...p.warnings)
    out.people!.push(...(p.people ?? []))
    out.report!.push(...(p.report ?? []))
  })
  return out
}
