/**
 * The shared extension list that defines the document schema.
 * getExtensions() (convert.ts) uses it as-is; the live editor (extensions/kit.ts)
 * passes `wrap` to attach React node views to individual nodes.
 */
import type { AnyExtension } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { DetailsContent, DetailsSummary } from '@tiptap/extension-details'
import { TableKit } from '@tiptap/extension-table'
import { BlockMath } from '@tiptap/extension-mathematics'
import { TextStyle } from '@tiptap/extension-text-style'
import UniqueID from '@tiptap/extension-unique-id'
import { createLowlight, common } from 'lowlight'
import {
  BlockImage,
  Bookmark,
  Callout,
  ColorHighlight,
  Column,
  Columns,
  DatabaseBlock,
  Embed,
  FileBlock,
  MarkdownDetails,
  Mention,
  Mermaid,
  PageLink,
  StrictInlineMath,
  TextColor,
  Toc,
} from './nodes'

export const lowlight = createLowlight(common)

/** Block types that carry a stable `id` attribute (block links, ?b=…, TOC anchors). */
export const BLOCK_ID_TYPES = [
  'paragraph',
  'heading',
  'blockquote',
  'bulletList',
  'orderedList',
  'taskList',
  'listItem',
  'taskItem',
  'codeBlock',
  'callout',
  'details',
  'image',
  'table',
  'columns',
  'horizontalRule',
  'blockMath',
  'mermaid',
  'pageLink',
  'databaseBlock',
  'bookmark',
  'embed',
  'toc',
  'fileBlock',
]

export type ExtensionWrap = Partial<Record<string, (ext: AnyExtension) => AnyExtension>>

export function baseExtensions({ readOnly = false, wrap = {} }: { readOnly?: boolean; wrap?: ExtensionWrap } = {}): AnyExtension[] {
  const w = (name: string, ext: AnyExtension) => (wrap[name] ? wrap[name]!(ext) : ext)
  return [
    StarterKit.configure({
      codeBlock: false,
      heading: { levels: [1, 2, 3] },
      link: {
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        defaultProtocol: 'https',
        HTMLAttributes: { target: null, rel: 'noopener noreferrer nofollow', class: null },
      },
      dropcursor: { color: 'var(--signal)', width: 2, class: 'drop-cursor' },
      undoRedo: readOnly ? false : { depth: 200 },
      trailingNode: readOnly ? false : undefined,
    }),
    w('codeBlock', CodeBlockLowlight.configure({ lowlight, defaultLanguage: null, enableTabIndentation: true, tabSize: 2 } as never)),
    TaskList,
    TaskItem.configure({ nested: true }),
    w('details', MarkdownDetails.configure({ persist: true, HTMLAttributes: { class: 'toggle' } })),
    DetailsSummary,
    DetailsContent,
    TableKit.configure({ table: { resizable: !readOnly, HTMLAttributes: { class: 'doc-table' } } }),
    w('blockMath', BlockMath),
    w('inlineMath', StrictInlineMath),
    w('image', BlockImage),
    ColorHighlight,
    TextStyle,
    TextColor,
    w('callout', Callout),
    Columns,
    Column,
    w('mermaid', Mermaid),
    w('pageLink', PageLink),
    w('mention', Mention),
    w('databaseBlock', DatabaseBlock),
    w('bookmark', Bookmark),
    w('embed', Embed),
    w('toc', Toc),
    w('fileBlock', FileBlock),
    UniqueID.configure({ types: BLOCK_ID_TYPES, attributeName: 'id' }),
  ]
}
