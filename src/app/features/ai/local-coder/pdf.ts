import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

GlobalWorkerOptions.workerSrc = workerUrl

export interface PdfSourcePage { number: number; text: string }
/** Bounded local source extraction; page numbers always refer to the original file. */
export async function pdfSourcePages(bytes: Uint8Array, signal?: AbortSignal, options: {maxPages?:number;maxCharacters?:number;onPage?:(done:number,total:number)=>void} = {}): Promise<{ pages: PdfSourcePage[]; totalPages: number }> {
  signal?.throwIfAborted()
  const loading = getDocument({ data: bytes, useSystemFonts: false, disableFontFace: true, useWorkerFetch: false, enableXfa: false })
  loading.onPassword = () => { void loading.destroy() }
  const cancel = () => { void loading.destroy() }
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    const pdf = await loading.promise
    if (pdf.numPages > (options.maxPages ?? 200)) throw Error('PDF_SOURCE_PAGES')
    const pages: PdfSourcePage[] = []; let characters = 0
    for (let number = 1; number <= pdf.numPages; number++) {
      signal?.throwIfAborted()
      const page = await pdf.getPage(number), content = await page.getTextContent()
      const text = content.items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('').trim()
      page.cleanup(); characters += text.length
      if (characters > (options.maxCharacters ?? 1_000_000)) throw Error('PDF_SOURCE_TEXT')
      pages.push({ number, text }); options.onPage?.(number,pdf.numPages)
    }
    return { pages, totalPages: pdf.numPages }
  } finally { signal?.removeEventListener('abort', cancel); await loading.destroy() }
}

/** Extract text locally; no PDF JavaScript, external fonts, URLs, attachments or OCR. */
export async function pdfText(bytes: Uint8Array, max: number, signal?: AbortSignal): Promise<{ text: string; issue?: string }> {
  signal?.throwIfAborted()
  const loading = getDocument({ data: bytes, useSystemFonts: false, disableFontFace: true, useWorkerFetch: false })
  loading.onPassword = () => { void loading.destroy() }
  const cancel = () => { void loading.destroy() }
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    const pdf = await loading.promise
    let text = ''
    const count = Math.min(pdf.numPages, 100)
    for (let number = 1; number <= count; number++) {
      signal?.throwIfAborted()
      const page = await pdf.getPage(number)
      const content = await page.getTextContent()
      text += `\n[Page ${number}]\n` + content.items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('')
      page.cleanup()
      if (text.length >= max) return { text: text.slice(0, max), issue: 'clipped' }
    }
    return { text: text.replace(/\[Page \d+\]/g, '').trim() ? text : '', issue: count < pdf.numPages ? 'clipped' : text.replace(/\[Page \d+\]/g, '').trim() ? undefined : 'scan' }
  } finally { signal?.removeEventListener('abort', cancel); await loading.destroy() }
}
