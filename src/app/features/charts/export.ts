/**
 * Files out of a chart: SVG (one theme written in), PNG (2× pixels, the app's fonts embedded so
 * the picture looks like the screen), the data as TSV on the clipboard, Markdown for exports.
 */
import archivoLatin from '@fontsource-variable/archivo/files/archivo-latin-wdth-normal.woff2?url'
import monoLatin from '@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2?url'
import { readAsDataUrl } from '../../lib/files'
import { t } from '../../i18n'
import type { ChartData, ChartSpec } from './types'
import { chartToSvg } from './render/static'
import { currentTheme, type ChartTheme } from './render/palette'
import { chartDataToRows, chartDataToTsv } from './table'
import { formatValue } from './render/scale'
import { useWorkspace } from '../../store/store'

export function chartFileName(spec: ChartSpec, ext: string): string {
  const base = (spec.title || t('charts.block.label'))
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .toLowerCase()
  return `${base || 'chart'}.${ext}`
}

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 4000)
}

export interface FileOptions {
  width?: number
  theme?: ChartTheme
}

export function chartSvgFile(spec: ChartSpec, data: ChartData, opts: FileOptions = {}): string {
  return chartToSvg(spec, data, { width: Math.max(320, Math.min(1600, Math.round(opts.width ?? 880))), theme: opts.theme ?? currentTheme() })
}

export function downloadChartSvg(spec: ChartSpec, data: ChartData, opts: FileOptions = {}): void {
  save(new Blob([chartSvgFile(spec, data, opts)], { type: 'image/svg+xml' }), chartFileName(spec, 'svg'))
}

let fontCss: Promise<string> | null = null
/** @font-face rules with the Latin subsets as data URLs (an SVG image can't reach the page's fonts). */
function embeddedFonts(): Promise<string> {
  fontCss ??= Promise.all(
    [
      ['Archivo Variable', archivoLatin, '100 900', 'font-stretch:62% 125%;'],
      ['JetBrains Mono Variable', monoLatin, '100 800', ''],
    ].map(async ([family, url, weight, extra]) => {
      try {
        const res = await fetch(url)
        if (!res.ok) return ''
        const data = await readAsDataUrl(await res.blob())
        return `@font-face{font-family:'${family}';font-weight:${weight};${extra}src:url(${data}) format('woff2')}`
      } catch {
        return ''
      }
    }),
  ).then((list) => list.join(''))
  return fontCss
}

export async function chartPngBlob(spec: ChartSpec, data: ChartData, opts: FileOptions = {}): Promise<Blob> {
  const svg = chartSvgFile(spec, data, opts)
  const fonts = await embeddedFonts()
  const withFonts = fonts ? svg.replace(/^<svg([^>]*)>/, `<svg$1><style>${fonts}</style>`) : svg
  const w = Number(svg.match(/\bwidth="([\d.]+)"/)?.[1] ?? 880)
  const h = Number(svg.match(/\bheight="([\d.]+)"/)?.[1] ?? 400)
  const scale = 2
  const img = new Image()
  img.decoding = 'async'
  const url = URL.createObjectURL(new Blob([withFonts], { type: 'image/svg+xml' }))
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('svg image failed'))
      img.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(w * scale)
    canvas.height = Math.round(h * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no canvas')
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('png failed'))), 'image/png'))
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function downloadChartPng(spec: ChartSpec, data: ChartData, opts: FileOptions = {}): Promise<void> {
  save(await chartPngBlob(spec, data, opts), chartFileName(spec, 'png'))
}

export async function copyChartTsv(data: ChartData, labelHeader = ''): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(chartDataToTsv(data, labelHeader))
    return true
  } catch {
    return false
  }
}

const mdCell = (s: string) => s.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ')

/** The chart's data as a Markdown table, the title as caption above it. */
export function chartMarkdown(spec: ChartSpec | null, data: ChartData | null): string {
  const title = spec?.title?.trim() || t('charts.block.label')
  const caption = `**${mdCell(title)}**`
  if (!spec || !data || data.error || !data.labels.length) return data?.error ? `${caption}\n\n_${mdCell(data.error)}_` : caption
  const lang = useWorkspace.getState().settings.language === 'de' ? 'de' : 'en'
  const fmt = { lang, unit: spec.unit || data.unit, decimals: spec.decimals } as const
  const rows = chartDataToRows(data, t('charts.table.label'))
  const head = rows[0].map((c) => mdCell(String(c ?? '')))
  const lines = [`| ${head.join(' | ')} |`, `| ${head.map((_, i) => (i === 0 ? '---' : '---:')).join(' | ')} |`]
  for (const r of rows.slice(1)) lines.push(`| ${r.map((c, i) => mdCell(i === 0 ? String(c ?? '') : formatValue(typeof c === 'number' ? c : null, fmt))).join(' | ')} |`)
  return `${caption}\n\n${lines.join('\n')}`
}
