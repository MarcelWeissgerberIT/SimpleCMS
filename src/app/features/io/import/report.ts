/**
 * Import report: what an import could not carry over 1:1 (unresolved links, skipped files …).
 * Planners collect items; the Import dialog groups them by code and shows them with the summary.
 */

export type ReportCode =
  /** [[wiki link]] / Evernote note link without a target — kept as plain text */
  | 'link'
  /** ![[embed]] or <en-media> without a file — left out */
  | 'embed'
  /** files the importer does not understand (Obsidian canvas, unknown JSON …) */
  | 'skipped'
  /** Evernote: encrypted text (cannot be decrypted here) */
  | 'crypt'
  /** Trello: archived lists / cards are not imported */
  | 'archived'
  /** an empty CSV (database without rows) */
  | 'emptyCsv'
  /** a Notion HTML export: pages yes, but databases come in as tables */
  | 'notionHtml'

export interface ReportItem {
  code: ReportCode
  /** what (link text, file name, count …) */
  detail: string
  /** where (page title), if known */
  where?: string
}

/** Turn the planners' legacy string warnings into report items. */
export function warningsToReport(warnings: string[]): ReportItem[] {
  const out: ReportItem[] = []
  for (const w of warnings) {
    if (w.startsWith('empty-csv:')) out.push({ code: 'emptyCsv', detail: w.slice('empty-csv:'.length) })
  }
  return out
}

/** Items grouped by code, in a stable order. */
export function groupReport(items: ReportItem[]): Array<{ code: ReportCode; items: ReportItem[] }> {
  const order: ReportCode[] = ['link', 'embed', 'crypt', 'archived', 'skipped', 'emptyCsv', 'notionHtml']
  const map = new Map<ReportCode, ReportItem[]>()
  for (const it of items) {
    const list = map.get(it.code)
    if (list) list.push(it)
    else map.set(it.code, [it])
  }
  return order.filter((c) => map.has(c)).map((code) => ({ code, items: map.get(code)! }))
}
