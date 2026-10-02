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
    callout: withView(CalloutView),
    codeBlock: withView(CodeBlockView),
    image: withView(ImageView),
    blockMath: withView(BlockMathView),
    inlineMath: withView(InlineMathView, { as: 'span' }),
    mermaid: withView(MermaidView),
    pageLink: withView(PageLinkView),
    mention: withView(MentionView, { as: 'span' }),
    databaseBlock: withView(DatabaseBlockView, stopAll),
    bookmark: withView(BookmarkView),
    embed: withView(EmbedView),
    toc: withView(TocView),
    fileBlock: withView(FileBlockView),
  }
}
