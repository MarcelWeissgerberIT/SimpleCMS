/**
 * One Script runtime — Markdown a script writes into pages (create.page(markdown: …), .append(…)):
 *  - md_table(rows, columns?): a query, rows, records or plain values as a Markdown table — titles link
 *    to their pages (`#/p/<id>`), properties read like the database shows them.
 *  - md_chart(data, kind?, title?): a chart block. The text is a ```chart fence holding a ChartSpec with
 *    manual data; when a script writes it into a page it becomes a real `chart` block (chartBlocks()).
 *    Data: the groups of .group(…) (key → count), a record {Open: 3, Done: 5}, records (the first text
 *    field labels, the number fields are series) or [label, number] pairs.
 */
import type { JSONContent } from '@tiptap/core'
import { normalizeSpec } from '../../charts'
import { SRecord, ScriptError, argAt, needList, needText, toText, typeName, type CallCtx, type Args, type Value } from '../lang'
import { tabulate } from './table'
import type { Cell } from './types'

/** Rows a Markdown table holds at most (a line says how many more there are). */
export const MD_TABLE_MAX = 1000

const KINDS = ['bar', 'barH', 'stacked', 'line', 'area', 'donut', 'kpi', 'sparkline']

/** A table cell as Markdown: one line, pipes escaped, pages as links. */
function mdCell(c: Cell): string {
  const esc = (s: string) => s.replace(/\r?\n/g, ' ').replace(/\\/g, '\\\\').replace(/\|/g, '\\|').trim()
  if (typeof c === 'string') return esc(c) || ' '
  const label = esc(c.text).replace(/[[\]]/g, (x) => `\\${x}`) || '—'
  return `[${label}](#/p/${c.pageId})`
}

/** The column names given to md_table: a list, or the texts after the value. */
function columnsArg(args: Args, ctx: CallCtx): string[] | null {
  const second = argAt(args, 1, 'columns')
  if (second === null) return null
  const list = Array.isArray(second) ? second : args.pos.slice(1)
  const out = list.map((x) => needText(x, ctx).trim()).filter(Boolean)
  return out.length ? out : null
}

export async function mdTable(args: Args, ctx: CallCtx): Promise<string> {
  const v = argAt(args, 0, 'rows')
  if (v === null) return ''
  const opts = { columns: columnsArg(args, ctx), max: MD_TABLE_MAX }
  const table = (await tabulate(v, ctx, opts)) ?? (await tabulate([v], ctx, opts))
  if (!table) return toText(v)
  const head = `| ${table.columns.map((c) => mdCell(c)).join(' | ')} |`
  const rule = `| ${table.columns.map(() => '---').join(' | ')} |`
  const rows = table.rows.map((r) => `| ${r.cells.map(mdCell).join(' | ')} |`)
  const more = table.total > table.rows.length ? [``, `… ${table.total - table.rows.length}`] : []
  return [head, rule, ...rows, ...more].join('\n')
}

/* ------------------------------------------------------------------ charts */

type Row = Array<string | number | null>

const num = (v: Value): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const label = (v: Value): string => (v === null || v === '' ? '—' : toText(v).replace(/`/g, "'").slice(0, 120))

/** The data of md_chart as manual rows (first row = headers, first column = labels). */
function chartRows(data: Value, ctx: CallCtx): Row[] {
  const count = ctx.lang === 'de' ? 'Anzahl' : 'Count'
  const value = ctx.lang === 'de' ? 'Wert' : 'Value'
  if (data instanceof SRecord) {
    const rows: Row[] = [['', value]]
    for (const [k, v] of data.fields) rows.push([label(k), num(v)])
    return rows
  }
  const list = needList(data, ctx)
  if (!list.length) return []
  if (list.every((x) => Array.isArray(x))) return [['', value], ...(list as Value[][]).map((x) => [label(x[0] ?? null), ...x.slice(1).map(num)])]
  if (list.every((x) => x instanceof SRecord)) {
    const recs = list as SRecord[]
    const fields = [...recs[0].fields.keys()]
    // groups of .group(…): key → count
    if (fields.includes('key') && fields.includes('count')) return [['', count], ...recs.map((r) => [label(r.fields.get('key') ?? null), num(r.fields.get('count') ?? null)])]
    const numeric = fields.filter((f) => recs.some((r) => num(r.fields.get(f) ?? null) !== null) && recs.every((r) => r.fields.get(f) === null || num(r.fields.get(f) ?? null) !== null))
    const lab = fields.find((f) => !numeric.includes(f)) ?? null
    if (!numeric.length) throw new ScriptError('bad_args', { name: 'md_chart', detail: 'no numbers to chart (try .group(Status))' }, ctx.pos)
    return [['', ...numeric], ...recs.map((r) => [lab ? label(r.fields.get(lab) ?? null) : '', ...numeric.map((f) => num(r.fields.get(f) ?? null))])]
  }
  if (list.every((x) => typeof x === 'number')) return [['', value], ...list.map((x, i) => [String(i + 1), x as number])]
  throw new ScriptError('bad_args', { name: 'md_chart', detail: `expected groups, records or numbers, got a list of ${typeName(list[0])}` }, ctx.pos)
}

export function mdChart(args: Args, ctx: CallCtx): string {
  const data = argAt(args, 0, 'data')
  const kindArg = argAt(args, 1, 'kind')
  const titleArg = argAt(args, 2, 'title')
  const kind = kindArg === null ? 'bar' : needText(kindArg, ctx).trim()
  const k = KINDS.find((x) => x.toLowerCase() === kind.toLowerCase())
  if (!k) throw new ScriptError('bad_args', { name: 'md_chart', detail: `the kind is one of ${KINDS.join(', ')}` }, ctx.pos)
  const rows = chartRows(data, ctx)
  if (rows.length < 2) return ''
  const spec = { kind: k, ...(titleArg === null ? {} : { title: needText(titleArg, ctx).replace(/`/g, "'").slice(0, 200) }), source: { kind: 'manual', rows }, labels: 'firstColumn', seriesIn: 'columns' }
  return `\`\`\`chart\n${JSON.stringify(spec)}\n\`\`\``
}

/** ```chart fences of md_chart → `chart` blocks (anything that is not a valid chart stays code). */
export function chartBlocks(doc: JSONContent): JSONContent {
  const content = doc.content
  if (!content?.some((b) => b.type === 'codeBlock' && b.attrs?.language === 'chart')) return doc
  return {
    ...doc,
    content: content.map((b) => {
      if (b.type !== 'codeBlock' || b.attrs?.language !== 'chart') return b
      const spec = normalizeSpec((b.content ?? []).map((c) => c.text ?? '').join(''))
      return spec ? { type: 'chart', attrs: { spec } } : b
    }),
  }
}
