import { unzipBounded } from '../file/zip'

export interface CoderAttachment { id: string; name: string; text: string; selected: boolean; issue?: string }
export const FILE_MAX = 10 * 1024 * 1024
export const FILE_COUNT = 100
const TEXT_MAX = 80_000
const TOTAL_TEXT = 500_000
const SKIP = /^(?:\..*|node_modules|vendor|dist|build|coverage|__MACOSX)$/i
const PRIVATE = /^(?:\.env(?:\..*)?|.*\.(?:pem|key|p12|pfx|keystore)|id_(?:rsa|ed25519)|credentials(?:\..*)?)$/i
const TEXT = /\.(?:txt|md|mdx|rst|csv|tsv|json|jsonc|jsonl|yaml|yml|toml|xml|html?|css|scss|less|[cm]?[jt]sx?|vue|svelte|py|rb|rs|go|java|kt|swift|c|h|cpp|hpp|cs|php|sql|sh|bash|zsh|ps1|bat|ini|cfg|conf|log|graphql|gql|svg|tex)$/i
export function permittedAttachment(name: string): boolean {
  const parts = name.replaceAll('\\', '/').split('/')
  return name.length <= 512 && !name.startsWith('/') && !/^[A-Za-z]:/.test(name) && parts.every(p => !!p && p !== '..' && !SKIP.test(p) && !PRIVATE.test(p))
}
const supported = (name: string) => TEXT.test(name) || /\.(pdf|docx|xlsx)$/i.test(name) || /(?:^|\/)(?:README|LICENSE|Dockerfile|Makefile)$/i.test(name)

async function extract(bytes: Uint8Array, name: string, signal?: AbortSignal): Promise<{ text: string; issue?: string }> {
  if (/\.pdf$/i.test(name)) {
    const { pdfText } = await import('./pdf')
    return pdfText(bytes, TEXT_MAX, signal)
  }
  if (/\.docx$/i.test(name)) {
    unzipBounded(bytes, name => name.endsWith('.xml'), 12 * 1024 * 1024)
    const { docxToDoc } = await import('../file/docx')
    const lines: string[] = []
    const visit = (n: { text?: string; content?: any[] }) => { if (n.text) lines.push(n.text); for (const child of n.content ?? []) visit(child); if (n.content) lines.push('\n') }
    const result = docxToDoc(bytes)
    if (result.title) lines.push(result.title + '\n')
    visit(result.doc)
    return { text: lines.join(''), issue: result.images ? 'images' : undefined }
  }
  if (/\.xlsx$/i.test(name)) {
    unzipBounded(bytes, name => name.endsWith('.xml'), 12 * 1024 * 1024)
    const { xlsxSheets } = await import('../file/xlsx')
    const sheets = xlsxSheets(bytes)
    return { text: sheets.map(s => `# ${s.name}\n${[s.header, ...s.rows].map(r => r.join('\t')).join('\n')}`).join('\n\n'), issue: sheets.some(s => s.total > s.rows.length) ? 'clipped' : 'table' }
  }
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  if (text.includes('\0')) throw new Error('unsupported')
  return { text }
}

/** Selected files only. Nothing is uploaded, executed or persisted during extraction. */
export async function readAttachments(files: File[], signal?: AbortSignal, textBudget = TOTAL_TEXT): Promise<CoderAttachment[]> {
  const out: CoderAttachment[] = []
  let totalBytes = 0
  let totalText = 0
  const add = async (name: string, bytes?: Uint8Array, issue?: string) => {
    signal?.throwIfAborted()
    if (out.length >= FILE_COUNT) throw new Error('count')
    const entry: CoderAttachment = { id: crypto.randomUUID(), name, text: '', selected: false, issue }
    if (!issue && bytes) {
      try {
        const result = await extract(bytes, name, signal)
        signal?.throwIfAborted()
        entry.text = result.text.slice(0, Math.min(TEXT_MAX, Math.max(0, textBudget - totalText)))
        entry.issue = entry.text.length < result.text.length ? 'clipped' : result.issue
        if (!entry.text.trim()) entry.issue = result.text.trim() ? 'clipped' : result.issue ?? 'empty'
        entry.selected = !!entry.text.trim()
        totalText += entry.text.length
      } catch (e) { signal?.throwIfAborted(); entry.issue = e instanceof Error && e.message === 'unsupported' ? 'unsupported' : 'unreadable' }
    }
    out.push(entry)
  }
  if (files.length > 20000) throw new Error('count')
  for (const file of files) {
    signal?.throwIfAborted()
    const name = file.webkitRelativePath || file.name
    if (!permittedAttachment(name)) { if (!file.webkitRelativePath) await add(name, undefined, 'excluded'); continue }
    totalBytes += file.size
    if (file.size > FILE_MAX || totalBytes > 50 * 1024 * 1024) { await add(name, undefined, 'large'); continue }
    if (/\.zip$/i.test(name)) {
      try {
        let count = 0
        const entries = unzipBounded(new Uint8Array(await file.arrayBuffer()), path => {
          if (++count > 3000) throw new Error('count')
          return permittedAttachment(path) && supported(path)
        }, 12 * 1024 * 1024)
        if (!Object.keys(entries).length) await add(name, undefined, 'empty')
        for (const [path, bytes] of Object.entries(entries)) {
          if (out.length >= FILE_COUNT) throw new Error('count')
          await add(`${name}/${path}`, bytes.length > FILE_MAX ? undefined : bytes, bytes.length > FILE_MAX ? 'large' : undefined)
        }
      } catch (e) { if (e instanceof Error && e.message === 'count') throw e; await add(name, undefined, 'unreadable') }
    } else if (supported(name) || file.type.startsWith('text/')) await add(name, new Uint8Array(await file.arrayBuffer()))
    else await add(name, undefined, 'unsupported')
  }
  return out
}

/** Retrieve bounded, named passages rather than silently chopping the end off a folder. */
export function attachmentContext(files: CoderAttachment[], task: string, budget: number): { text: string; passages: number; omitted: number } {
  const terms = [...new Set(task.toLowerCase().match(/[\p{L}\p{N}_-]{3,}/gu) ?? [])].slice(0, 60)
  const chunks: Array<{ name: string; start: number; text: string; score: number; order: number }> = []
  for (const file of files.filter(f => f.selected && f.text)) {
    const lines = file.text.split('\n')
    let block = ''; let start = 1
    const push = () => {
      if (!block) return
      const haystack = `${file.name}\n${block}`.toLowerCase()
      const score = terms.reduce((sum, t) => sum + (haystack.includes(t) ? 1 : 0) + (file.name.toLowerCase().includes(t) ? 2 : 0), 0)
      chunks.push({ name: file.name, start, text: block, score, order: chunks.length })
    }
    lines.forEach((line, i) => {
      // Very long/minified lines are split too, so one file cannot consume the entire context.
      for (let at = 0; at < Math.max(1, line.length); at += 1800) {
        const piece = line.slice(at, at + 1800) + '\n'
        if (block.length + piece.length > 2400) { push(); block = ''; start = i + 1 }
        block += piece
      }
    })
    push()
  }
  chunks.sort((a, b) => b.score - a.score || a.order - b.order)
  let text = ''; let passages = 0
  for (const chunk of chunks) {
    const part = `\n--- ${JSON.stringify(chunk.name)} · line ${chunk.start} ---\n${chunk.text}`
    if (text.length + part.length > budget) continue
    text += part; passages++
  }
  return { text, passages, omitted: chunks.length - passages }
}
