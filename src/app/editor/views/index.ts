/** React node views, attached to schema nodes for the live editor (and ReadOnlyDoc). */
import type { AnyExtension } from '@tiptap/core'
import { ReactNodeViewRenderer, type ReactNodeViewProps, type ReactNodeViewRendererOptions } from '@tiptap/react'
import type { ComponentType } from 'react'
import type { ExtensionWrap } from '../schema/base'
import { CalloutView } from './CalloutView'
import { CodeBlockView } from './CodeBlockView'
import { ImageView } from './ImageView'
import { BlockMathView, InlineMathView } from './MathView'
import { MermaidView } from './MermaidView'
import { MentionView, PageLinkView } from './LinkViews'
import { BookmarkView, EmbedView, FileBlockView } from './MediaViews'
import { DatabaseBlockView, TocView } from './TocView'
import { guardView } from './BrokenBlock'
import { ButtonView, StaticButtonView } from './ButtonView'
import { StaticTabsView, TabsView, tabsViewOptions } from './TabsView'
import { SyncedBlockView, syncedViewOptions } from './SyncedBlockView'
import { AudioView, VideoView } from './MediaBlockViews'
import { MeetingNotesView, meetingViewOptions } from './MeetingNotesView'
import { SpreadsheetView, spreadsheetViewOptions } from './SpreadsheetView'
import { ChartBlockView, chartViewOptions } from './ChartBlockView'
import { withInlineIconView } from './InlineIconView'
import { BreadcrumbView } from './BreadcrumbView'
import './views.css'
import './toggle.css'

type View = ComponentType<ReactNodeViewProps>

function withView(view: View, opts: Partial<ReactNodeViewRendererOptions> = {}) {
  return (ext: AnyExtension) =>
    (ext as AnyExtension & { extend: (c: object) => AnyExtension }).extend({
      addNodeView() {
        return ReactNodeViewRenderer(view, opts)
      },
    })
}

/** Events inside these views belong to React (inputs, embedded database UI …). */
const stopAll = { stopEvent: () => true, ignoreMutation: () => true }

/** Presses on the button's controls (also on their label / icon) never select the block. */
const buttonEvents = {
  stopEvent: ({ event }: { event: Event }) => !event.type.startsWith('drag') && event.type !== 'drop' && !!(event.target as Element | null)?.closest?.('button'),
}

export function nodeViewWraps({ readOnly }: { readOnly: boolean }): ExtensionWrap {
  return {
    // views with editable content (NodeViewContent) stay unwrapped: a fallback would drop the content hole
    callout: withView(CalloutView),
    codeBlock: withView(CodeBlockView),
    // atoms: one bad block renders a "broken block · remove" plate instead of failing the page
    image: withView(guardView(ImageView)),
    blockMath: withView(guardView(BlockMathView)),
    inlineMath: withView(guardView(InlineMathView, { inline: true }), { as: 'span' }),
    mermaid: withView(guardView(MermaidView)),
    pageLink: withView(guardView(PageLinkView)),
    mention: withView(guardView(MentionView, { inline: true }), { as: 'span' }),
    // plain DOM view: no React root per icon
    icon: withInlineIconView,
    databaseBlock: withView(guardView(DatabaseBlockView), stopAll),
    bookmark: withView(guardView(BookmarkView)),
    embed: withView(guardView(EmbedView)),
    toc: withView(guardView(TocView)),
    fileBlock: withView(guardView(FileBlockView)),
    video: withView(guardView(VideoView)),
    audio: withView(guardView(AudioView)),
    // read-only renders (share, history, slides) get a disabled key that never runs
    button: withView(guardView(readOnly ? StaticButtonView : ButtonView), buttonEvents),
    // the strip is React's; the tab panels are ProseMirror content (no guard: it would drop the content hole)
    tabs: withView(readOnly ? StaticTabsView : TabsView, tabsViewOptions),
    // read-only renders show the plain content (schema HTML, no frame)
    ...(readOnly ? {} : { syncedBlock: withView(SyncedBlockView, syncedViewOptions) }),
    // meeting notes: controls from the features area around the notes (content hole: no guard)
    meetingNotes: withView(MeetingNotesView, meetingViewOptions),
    // spreadsheet: the grid (lazy) while editing; read-only renders show the schema's static tables
    ...(readOnly ? {} : { spreadsheet: withView(guardView(SpreadsheetView), spreadsheetViewOptions) }),
    // chart: the live chart (features/charts); read-only renders keep the readouts, without the tools
    chart: withView(guardView(ChartBlockView), chartViewOptions),
    // breadcrumb: the live path of the page (read-only renders: the open page, or the frozen titles)
    breadcrumb: withView(guardView(BreadcrumbView)),
  }
}
