/**
 * "Picture · zoom" (plan §3.4, §6 U32): the whole rack as one static SVG (render.ts renderStatic — the unfiltered
 * layout, every fold named) in the diagram viewer (kind 'schematic': zoom, minimap, Download SVG). Colours resolved to
 * the theme's stock tokens and flattened (colors.ts flatColor), so the file holds no `var(`, `color-mix(` or `oklch(`;
 * the words are the page's own. B7 owns its spec (the download, the viewer's focus) and any polish.
 */
import { activeWorkspace, useCloud } from '../../../cloud'
import { useWorkspace } from '../../../store/store'
import { openDiagramViewer } from '../../../ui/viewer'
import { currentTheme, resolveVars } from '../../charts'
import { flatColor } from '../colors'
import { layoutRack } from '../layout'
import { renderStatic, type StaticText } from '../render'
import type { FuseState, Model } from '../types'
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
    name: (m) => w.name(m),
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
  openDiagramViewer(
    {
      kind: 'schematic',
      type: w.t(`${P}.picture.type`),
      title,
      themed: true,
      fileName: w.t(`${P}.picture.file`),
      render: () => {
        const theme = currentTheme()
        return renderStatic(model, layoutRack(model, { fuses }), { resolve: (s) => resolveVars(s, theme), flat: flatColor, text: staticText(w, model), title, fuses })
      },
    },
    { from },
  )
}
