/**
 * Inline icon — node `icon` (inline atom, selectable). Attrs:
 *   kind   'asset'  a generated ceramic object: name = file in public/assets/icons (manifest.json)
 *          'lucide' a lucide glyph: name = lucide's kebab-case name (icons/glyphSet.ts)
 *   name   see kind
 *   color  ColorName | null — glyphs only; null = the current text colour
 * Outside the editor:
 *   HTML      <span data-type="icon" data-kind data-name [data-color]> around an inline <img> (object)
 *             or <svg> (glyph), sized to the line with inline styles so any stylesheet shows it right
 *   Markdown  objects ![Clock](assets/icons/clock.webp) · glyphs :icon-rocket: / :icon-rocket@red:
 *             (both come back as icons on import — see convert.ts for the image form)
 *   text      [Clock] / :rocket:   (copy as plain text, search, getText)
 */
import { Node, mergeAttributes, type JSONContent } from '@tiptap/core'
import { COLOR_NAMES, type ColorName } from '../../store/types'
import { useWorkspace } from '../../store/store'
import { t } from '../../i18n'
import { escapeMarkdownText } from '../lib/mdText'
import { objectLabel } from '../icons/objects'
import { glyphSpec, loadGlyphs, loadedGlyphs } from '../icons/glyphs'

export const ICON = 'icon'
/** Dispatched on the editor's DOM by a click on an inline icon (detail: { pos }) — opens its popover. */
export const ICON_EDIT_EVENT = 'one:icon-edit'

export type IconKind = 'asset' | 'lucide'
export interface IconAttrs {
  kind: IconKind
  name: string
  color: ColorName | null
}

const ASSET_NAME = /^[\w-]{1,64}$/
const GLYPH_NAME = /^[a-z0-9]+(?:-[a-z0-9]+){0,7}$/
const COLORS = new Set<string>(COLOR_NAMES.filter((c) => c !== 'default'))
/** Exported icons: line-sized, sitting on the baseline like a capital letter. */
const INLINE_STYLE = 'display:inline-block;width:1.15em;height:1.15em;vertical-align:-0.22em'

/** Attrs as stored, normalised (unknown kind → glyph, colour only for glyphs and only a ColorName). */
export function iconAttrs(raw: Record<string, unknown> | null | undefined): IconAttrs {
  const kind: IconKind = raw?.kind === 'asset' ? 'asset' : 'lucide'
  const name = typeof raw?.name === 'string' ? raw.name : ''
  const color = kind === 'lucide' && typeof raw?.color === 'string' && COLORS.has(raw.color) ? (raw.color as ColorName) : null
  return { kind, name, color }
}

export const validIcon = (a: IconAttrs) => (a.kind === 'asset' ? ASSET_NAME : GLYPH_NAME).test(a.name)
export const iconAssetPath = (name: string) => `assets/icons/${name}.webp`

/** What the icon is called: an object by its label (UI language), a glyph as ":name:". */
export function iconLabel(a: IconAttrs, lang = useWorkspace.getState().settings.language): string {
  if (!validIcon(a)) return t('editor.icon.unknown')
  return a.kind === 'asset' ? objectLabel(a.name, lang) : `:${a.name}:`
}

/** Markdown image of an object icon (`![Clock](assets/icons/clock.webp)`) back to an inline icon. */
export function iconFromImage(n: JSONContent): JSONContent | null {
  const m = typeof n.attrs?.src === 'string' ? /^assets\/icons\/([\w-]{1,64})\.webp$/.exec(n.attrs.src) : null
  return m ? { type: ICON, attrs: { kind: 'asset', name: m[1], color: null } } : null
}

let preloading = false
/** Glyphs load at idle once an editor runs, so exports later on draw them as SVG. */
function preloadGlyphs() {
  if (preloading || typeof window === 'undefined') return
  preloading = true
  const run = () => void loadGlyphs().catch(() => {})
  if ('requestIdleCallback' in window) window.requestIdleCallback(run, { timeout: 4000 })
  else setTimeout(run, 1500)
}

export const InlineIcon = Node.create({
  name: ICON,
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      kind: {
        default: 'lucide',
        parseHTML: (el) => (el.getAttribute('data-kind') === 'asset' ? 'asset' : 'lucide'),
        renderHTML: (a) => ({ 'data-kind': a.kind }),
      },
      name: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-name') ?? '',
        renderHTML: (a) => ({ 'data-name': a.name }),
      },
      color: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-color') || null,
        renderHTML: (a) => (a.color ? { 'data-color': a.color } : {}),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'span[data-type="icon"]' }]
  },
  renderHTML({ node, HTMLAttributes }) {
    const a = iconAttrs(node.attrs)
    const label = iconLabel(a)
    const wrap = mergeAttributes(HTMLAttributes, { 'data-type': 'icon', class: `one-icon one-icon--${a.kind}`, title: label })
    if (!validIcon(a)) return ['span', wrap, label]
    if (a.kind === 'asset') return ['span', wrap, ['img', { src: iconAssetPath(a.name), alt: label, width: '20', height: '20', style: INLINE_STYLE }]]
    const glyph = loadedGlyphs()?.GLYPH_BY_NAME.get(a.name)
    const box = { ...wrap, role: 'img', 'aria-label': label }
    if (!glyph) {
      // not loaded yet (or unknown): the name stands in, the next render has the SVG
      if (!loadedGlyphs()) void loadGlyphs().catch(() => {})
      return ['span', box, label]
    }
    const color = a.color ? `;color:var(--c-${a.color}-text)` : ''
    return ['span', box, glyphSpec(glyph.node, { width: '20', height: '20', style: INLINE_STYLE + color })]
  },
  renderText({ node }) {
    const a = iconAttrs(node.attrs)
    return a.kind === 'asset' && validIcon(a) ? `[${iconLabel(a)}]` : iconLabel(a)
  },
  markdownTokenizer: {
    name: ICON,
    level: 'inline',
    start: (src: string) => src.indexOf(':icon-'),
    tokenize(src: string) {
      const m = /^:icon-([a-z0-9]+(?:-[a-z0-9]+){0,7})(?:@([a-z]{1,16}))?:/.exec(src)
      if (!m) return undefined
      return { type: ICON, raw: m[0], name: m[1], color: m[2] ?? null } as never
    },
  },
  parseMarkdown(token, h) {
    return h.createNode(ICON, iconAttrs({ kind: 'lucide', name: token.name, color: token.color }) as unknown as Record<string, unknown>)
  },
  renderMarkdown(node) {
    const a = iconAttrs(node.attrs)
    if (!validIcon(a)) return ''
    // English label: the same file every time, whatever the UI language (file sync, AI round trips)
    if (a.kind === 'asset') return `![${escapeMarkdownText(objectLabel(a.name, 'en'))}](${iconAssetPath(a.name)})`
    return `:icon-${a.name}${a.color ? `@${a.color}` : ''}:`
  },
  onCreate() {
    preloadGlyphs()
  },
})
