/**
 * Static charts: an SVG string (downloads, exports, share, the website) and the DOMOutputSpec
 * the `chart` node renders as HTML. Theme 'css' keeps the design tokens as var(--…) (the page
 * around it brings tokens.css: HTML export, website, share file); 'light' / 'dark' write one
 * theme's values in, for files that stand alone.
 */
import { t } from '../../../i18n'
import { useWorkspace } from '../../../store/store'
import type { ChartData, ChartSpec } from '../types'
import { chartHeight } from '../spec'
import { buildScene, type SceneText } from './scene'
import { resolveVars, type ChartTheme } from './palette'
import { toDomSpec, toSvgString } from './vnode'

export interface StaticOptions {
  width?: number
  height?: number
  theme?: ChartTheme | 'css'
  /** draw the title inside the SVG (default: true for light / dark files) */
  title?: boolean
  /** paint the surface colour behind the chart (default: true for light / dark files) */
  background?: boolean
  lang?: 'en' | 'de'
}

export function sceneText(): SceneText {
  return { other: t('charts.other'), total: t('charts.total'), versus: (label: string) => t('charts.versus', { label }), noData: t('charts.state.noData') }
}

const langNow = (): 'en' | 'de' => (useWorkspace.getState().settings.language === 'de' ? 'de' : 'en')

function scene(spec: ChartSpec, data: ChartData, opts: StaticOptions) {
  const standalone = opts.theme === 'light' || opts.theme === 'dark'
  return buildScene(spec, data, {
    width: opts.width ?? 720,
    height: opts.height ?? chartHeight(spec),
    lang: opts.lang ?? langNow(),
    text: sceneText(),
    title: opts.title ?? standalone,
    background: opts.background ?? standalone,
  })
}

/** The chart as a complete SVG document string. */
export function chartToSvg(spec: ChartSpec, data: ChartData, opts: StaticOptions = {}): string {
  const s = scene(spec, data, opts)
  const pad = opts.theme === 'light' || opts.theme === 'dark' ? 16 : 0
  let svg = s.svg
  if (pad) {
    // a margin around standalone files: the scene goes into a padded frame
    svg = {
      tag: 'svg',
      attrs: { ...s.svg.attrs, viewBox: `${-pad} ${-pad} ${s.width + pad * 2} ${s.height + pad * 2}`, width: s.width + pad * 2, height: s.height + pad * 2 },
      children: [{ tag: 'rect', attrs: { x: -pad, y: -pad, width: s.width + pad * 2, height: s.height + pad * 2, fill: 'var(--surface)' }, children: [] }, ...s.svg.children],
    }
  }
  const out = toSvgString(svg)
  return opts.theme === 'light' || opts.theme === 'dark' ? resolveVars(out, opts.theme) : out
}

/** DOMOutputSpec of the static chart (CSS-variable colours) for the node's renderHTML. */
export function chartDomSpec(spec: ChartSpec, data: ChartData, opts: StaticOptions = {}): unknown {
  const s = scene(spec, data, { ...opts, theme: 'css', title: false, background: false })
  s.svg.attrs.style = 'max-width:100%;height:auto'
  return toDomSpec(s.svg)
}
