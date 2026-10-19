import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

GlobalWorkerOptions.workerSrc = workerUrl

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
