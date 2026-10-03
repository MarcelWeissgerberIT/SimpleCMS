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
import './views.css'

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

export function nodeViewWraps(_opts: { readOnly: boolean }): ExtensionWrap {
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
    databaseBlock: withView(guardView(DatabaseBlockView), stopAll),
    bookmark: withView(guardView(BookmarkView)),
    embed: withView(guardView(EmbedView)),
    toc: withView(guardView(TocView)),
    fileBlock: withView(guardView(FileBlockView)),
  }
}
