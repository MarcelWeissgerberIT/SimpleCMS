/**
 * Work orders — the end of a chain (spec §1.7 "The end"): each step with its result — the merge / pull request (the PR
 * field, else what this device's worker reported last: TaskLocal.url, the ship log's link), the test cases a QA step made
 * (rows of the Test cases database that name it), what Claude Code cost on this device's worker (TaskLocal.spentUsd —
 * never the Cost field others can change). `writeSummary(row)` (W) writes it into the request as ONE callout — the
 * person's write (through the open editor when there is one), never into their text by itself; W again replaces it.
 */
import type { JSONContent } from '@tiptap/core'
import { useWorkspace } from '../../../store/store'
import { rowIdsOf } from '../../../store/rowIndex'
import type { ID } from '../../../store/types'
import { withWriter, type Writer } from '../../../store/writer'
import { editAs, liveEditorOf } from '../../../editor'
import { flushPageContent, useCloud } from '../../../cloud'
import { currentLang, t } from '../../../i18n'
import { fmtUsd } from '../../../lib/money'
import { codingProps, pipelineDbId, readPipeline, stageOfRow } from '../schema'
import { loadTask, taskLocal } from '../local'
import { orderCode } from './db'
import { stepNo } from './words'
import type { OrderChain } from './types'

const ws = () => useWorkspace.getState()
const YOU: Writer = { kind: 'you', via: 'ui' }
const O = 'features.coding.order'

export interface StepResult {
  n: number
  id: ID
  kind: OrderChain['steps'][number]['kind']
  title: string
  state: 'done' | 'skipped' | 'gone' | 'open'
  /** the merge / pull request */
  url: string | null
  /** test cases the step made */
  cases: number
  /** Claude Code on this device's worker ($) */
  usd: number
}

/** The test cases a QA task made (rows of the Test cases database whose first line names it). */
export function casesOf(taskId: ID): number {
  const dbId = pipelineDbId('testcases')
  if (!dbId) return 0
  const s = ws()
  let n = 0
  for (const id of rowIdsOf(dbId)) {
    const row = s.pages[id]
    if (!row || row.trashed) continue
    const first = (row.content?.content ?? [])[0] as JSONContent | undefined
    if (first?.content?.some((x) => x.type === 'mention' && x.attrs?.id === taskId)) n++
  }
  return n
}

/** Each step of a chain with its result (this device's worker reports read first). */
export async function stepResults(chain: OrderChain): Promise<StepResult[]> {
  const s = ws()
  const out: StepResult[] = []
  for (const st of [...chain.steps].sort((a, b) => a.n - b.n)) {
    const page = s.pages[st.id]
    await loadTask(st.id)
    const local = taskLocal(st.id)
    const db = page?.databaseId ? s.databases[page.databaseId] : undefined
    const pr = db ? codingProps(db).pr : undefined
    const field = pr && page && typeof page.properties[pr] === 'string' ? (page.properties[pr] as string).trim() : ''
    out.push({
      n: st.n,
      id: st.id,
      kind: st.kind,
      title: page?.title.trim() || st.title || t('common.untitled'),
      state: chain.skipped?.includes(st.n) ? 'skipped' : !page || page.trashed || !db ? 'gone' : stageOfRow(readPipeline(db), codingProps(db), page)?.kind === 'done' ? 'done' : 'open',
      url: field || local.url || null,
      cases: casesOf(st.id),
      usd: typeof local.spentUsd === 'number' && local.spentUsd > 0 ? local.spentUsd : 0,
    })
  }
  return out
}

/** One step's result as a line ("02 Coding ‹Titel› — MR: … · Claude Code 1,40 $"). */
export function resultLine(r: StepResult): string {
  const lang = currentLang()
  const parts: string[] = []
  if (r.state === 'skipped') parts.push(t(`${O}.summary.skipped`))
  else if (r.state === 'gone') parts.push(t(`${O}.lane.trashed`))
  if (r.url) parts.push(t(`${O}.summary.pr`, { url: r.url }))
  if (r.cases) parts.push(t(`${O}.summary.cases.${r.cases === 1 ? 'one' : 'other'}`, { n: r.cases }))
  if (r.usd > 0) parts.push(t(`${O}.summary.cost`, { usd: fmtUsd(r.usd, lang) }))
  return `${stepNo(r.n)} ${t(`features.coding.pipe.${r.kind}`)} ‹${r.title}›${parts.length ? ` — ${parts.join(' · ')}` : ''}`
}

/** The callout W writes (its id fixed per chain: W again replaces it). */
export function summaryBlock(rowId: ID, run: string, results: readonly StepResult[]): JSONContent {
  const lang = currentLang()
  const total = results.reduce((n, r) => n + r.usd, 0)
  const id = `${rowId}-sum-${run}`.slice(0, 120)
  const text = (s: string): JSONContent => ({ type: 'text', text: s })
  return {
    type: 'callout',
    attrs: { id, icon: 'asset:publish', color: 'green' },
    content: [
      { type: 'paragraph', attrs: { id: `${id}-h` }, content: [{ type: 'text', text: t(`${O}.summary.heading`, { id: orderCode(rowId) ?? '' }), marks: [{ type: 'bold' }] }] },
      { type: 'bulletList', attrs: { id: `${id}-l` }, content: results.map((r, i) => ({ type: 'listItem', attrs: { id: `${id}-i${i}` }, content: [{ type: 'paragraph', attrs: { id: `${id}-p${i}` }, content: [text(resultLine(r))] }] })) },
      ...(total > 0 ? [{ type: 'paragraph', attrs: { id: `${id}-t` }, content: [text(t(`${O}.summary.total`, { usd: fmtUsd(total, lang) }))] }] : []),
    ],
  }
}

/** W: the summary into the request (see the head of this file). False: nothing written (gone, locked, a viewer). */
export async function writeSummary(rowId: ID, chain: OrderChain): Promise<boolean> {
  const row = ws().pages[rowId]
  if (!row || row.trashed || row.settings?.locked || useCloud.getState().readOnly) return false
  const block = summaryBlock(rowId, chain.run, await stepResults(chain))
  const id = String(block.attrs!.id)
  const editor = liveEditorOf(rowId)
  if (editor && !editor.isDestroyed && editor.isEditable) {
    editAs(editor, YOU, () => {
      let at: { from: number; to: number } | null = null
      editor.state.doc.descendants((node, pos) => {
        if (at) return false
        if (node.attrs?.id === id) {
          at = { from: pos, to: pos + node.nodeSize }
          return false
        }
        return true
      })
      const target = at as { from: number; to: number } | null
      return target ? editor.chain().insertContentAt(target, block).run() : editor.chain().insertContentAt(editor.state.doc.content.size, block).run()
    })
    return true
  }
  if (useCloud.getState().active.kind === 'cloud') flushPageContent(rowId)
  const page = ws().pages[rowId]
  if (!page) return false
  const content = ((page.content?.content ?? []) as JSONContent[]).filter((b) => b.attrs?.id !== id)
  withWriter(YOU, () => ws().setContent(rowId, { type: 'doc', content: [...content, block] }, 'summary'))
  return true
}
