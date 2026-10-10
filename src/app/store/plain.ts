/** The plain text of TipTap JSON — pure (no store), so pure modules (merge.ts …) can use it. Re-exported by store.ts. */
import type { JSONContent } from '@tiptap/core'

/** Extract plain text from TipTap JSON (for search, excerpts, graph). */
export function plainText(node: JSONContent | null | undefined, max = 20000): string {
  if (!node) return ''
  let out = ''
  const walk = (n: JSONContent) => {
    if (out.length > max) return
    if (n.type === 'text' && n.text) out += n.text
    else if (n.type === 'mention' && n.attrs?.label) out += `@${n.attrs.label}`
    if (n.content) {
      for (const c of n.content) walk(c)
      if (n.type !== 'text' && n.type !== 'doc') out += '\n'
    }
    // meeting notes: the transcript lives in an attribute (editor/schema/meetingNotes.ts)
    if (n.type === 'meetingNotes' && Array.isArray(n.attrs?.transcript)) {
      for (const seg of n.attrs.transcript) if (seg?.text) out += `${seg.text}\n`
    }
    // spreadsheets: title, sheet names and what was typed into cells (not formulas — values are computed)
    if (n.type === 'spreadsheet') {
      if (typeof n.attrs?.title === 'string' && n.attrs.title) out += `${n.attrs.title}\n`
      for (const sheet of Array.isArray(n.attrs?.sheets) ? n.attrs.sheets : []) {
        if (out.length > max) break
        if (typeof sheet?.name === 'string') out += `${sheet.name}\n`
        const cells = sheet?.cells && typeof sheet.cells === 'object' ? Object.values(sheet.cells as Record<string, { v?: unknown }>) : []
        const typed = cells.map((c) => c?.v).filter((v): v is string => typeof v === 'string' && v !== '' && !v.startsWith('='))
        if (typed.length) out += `${typed.join(' ')}\n`
      }
    }
    // charts: their title (editor/schema/chart.ts)
    if (n.type === 'chart' && typeof n.attrs?.spec?.title === 'string' && n.attrs.spec.title) out += `${n.attrs.spec.title}\n`
  }
  walk(node)
  return out.replace(/\n{3,}/g, '\n\n').trim().slice(0, max)
}
