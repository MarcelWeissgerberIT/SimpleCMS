/**
 * "Picture · zoom" (plan §3.4, §6 U32): the whole rack as one static SVG (render.ts renderStatic — the unfiltered
 * layout, every fold named) in the diagram viewer (kind 'schematic': zoom, minimap, Download SVG). Colours resolved to
 * the theme's stock tokens and flattened (colors.ts flatColor), so the file holds no `var(`, `color-mix(` or `oklch(`;
 * the words are the page's own. Download SVG saves the picture itself (`file`), never the viewer's copy.
 */
import { activeWorkspace, useCloud } from '../../../cloud'
import { useWorkspace } from '../../../store/store'
import { openDiagramViewer } from '../../../ui/viewer'
import { currentTheme, resolveVars } from '../../charts'
import { flatColor } from '../colors'
import { layoutRack } from '../layout'
import { renderStatic, type StaticText } from '../render'
import type { FuseState, Model } from '../types'
import { buttonLabelIn } from './buttonLabel'
import type { Words } from './words'

const P = 'features.patchbay'

/** The workspace's name (the picture's title). */
function workspaceName(): string {
  const ref = activeWorkspace()
  if (ref.kind === 'cloud') return useCloud.getState().workspaces.find((w) => w.id === ref.id)?.name ?? ''
  return useWorkspace.getState().settings.workspaceName ?? ''
}

/** The page's words for the picture. */
export function staticText(w: Words, model: Model): StaticText {
  return {
    // a button by what it says, on its page ("Wochenbericht · Bericht") — as the rack shows it
    name: (m) => {
      if (m.ref.kind !== 'button') return w.name(m)
      const page = useWorkspace.getState().pages[m.ref.page]
      const label = buttonLabelIn(page?.content, m.ref.block)
      return label ? `${label} · ${page?.title.trim() || w.t(`${P}.untitled`)}` : w.name(m)
    },
    kind: (m) => w.kind(m).toLocaleUpperCase(),
    jack: (j, m) => w.jack(j, m).toLocaleUpperCase(),
    flag: (n) => w.flag(n).toLocaleUpperCase(),
    column: (col, c) => `§ 0${col} ${w.colName(col).toLocaleUpperCase()} · ${w.colCount(c).toLocaleUpperCase()}`,
    fold: (f) => {
      const x = w.fold(f)
      return `${x.label.toLocaleUpperCase()} · ${x.names.join(' · ')}`
    },
    bus: (b) => w.t(`${P}.bus`, { n: b.edges.length }),
    fuse: (f) => (model.fuses.find((x) => x.key === f.key)?.label ?? f.label),
  }
}

export function openPicture(model: Model, w: Words, from?: HTMLElement | null): void {
  const fuses = model.fuses as FuseState[]
  const title = workspaceName() || w.t(`${P}.title`)
  // the whole rack (no filter, every fold named), in the theme shown now — resolved and flattened
  const picture = () => {
    const theme = currentTheme()
    return renderStatic(model, layoutRack(model, { fuses }), { resolve: (s) => resolveVars(s, theme), flat: flatColor, text: staticText(w, model), title, fuses })
  }
  openDiagramViewer(
    {
      kind: 'schematic',
      type: w.t(`${P}.picture.type`),
      title,
      themed: true,
      fileName: w.t(`${P}.picture.file`),
      render: picture,
      // Download SVG: the picture itself as a file (its own size and background; no `var(`, `color-mix(`, `oklch(`) —
      // never the viewer's copy, which would carry the page's surface token
      file: () => `<?xml version="1.0" encoding="UTF-8"?>\n${picture()}`,
    },
    { from },
  )
}
