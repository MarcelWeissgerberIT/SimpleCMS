/**
 * The shared extension list that defines the document schema.
 * getExtensions() (convert.ts) uses it as-is; the live editor (extensions/kit.ts)
 * passes `wrap` to attach React node views to individual nodes.
 */
import { InputRule, type AnyExtension } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { DetailsContent, DetailsSummary } from '@tiptap/extension-details'
import { TableKit } from '@tiptap/extension-table'
import { BlockMath } from '@tiptap/extension-mathematics'
import { TextStyle } from '@tiptap/extension-text-style'
import UniqueID from '@tiptap/extension-unique-id'
import { createLowlight, common } from 'lowlight'
import { t } from '../../i18n'
import { OutlineHeading } from './heading'
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

/** Code blocks without a (known) language stay plain text — no highlight.js auto-detection guesses. */
const plainLowlight = { ...lowlight, highlightAuto: (value: string) => lowlight.highlight('plaintext', value) }

/**
 * "```lang␣" / "~~~lang␣" → code block. Only a known language name is taken as the language;
 * anything else ("```const ") is the first word of the code and stays in the block.
 */
const FencedCodeBlock = CodeBlockLowlight.extend({
  addInputRules() {
    const rule = (find: RegExp) =>
      new InputRule({
        find,
        handler: ({ state, range, match }) => {
          const $start = state.doc.resolve(range.from)
          if (!$start.node(-1).canReplaceWith($start.index(-1), $start.indexAfter(-1), this.type)) return null
          const word = match[1] ?? ''
          const known = !!word && lowlight.registered(word.toLowerCase())
          state.tr.delete(range.from, range.to).setBlockType(range.from, range.from, this.type, { language: known ? word.toLowerCase() : null })
          if (word && !known) state.tr.insertText(`${word} `, range.from)
        },
      })
    return [rule(/^```([a-z0-9]+)?[\s\n]$/i), rule(/^~~~([a-z0-9]+)?[\s\n]$/i)]
  },
})

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

export interface BaseExtensionOptions {
  readOnly?: boolean
  wrap?: ExtensionWrap
  /** DOM tag offset for heading blocks: 1 renders H1–H3 as <h2>–<h4> under a page title (JSON level unchanged). */
  headingOffset?: number
}

export function baseExtensions({ readOnly = false, wrap = {}, headingOffset = 0 }: BaseExtensionOptions = {}): AnyExtension[] {
  const w = (name: string, ext: AnyExtension) => (wrap[name] ? wrap[name]!(ext) : ext)
  return [
    StarterKit.configure({
      codeBlock: false,
      heading: false,
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
    OutlineHeading.configure({ levels: [1, 2, 3], outlineOffset: headingOffset }),
    w('codeBlock', FencedCodeBlock.configure({ lowlight: plainLowlight, defaultLanguage: null, enableTabIndentation: true, tabSize: 2 } as never)),
    TaskList,
    TaskItem.configure({
      nested: true,
      a11y: { checkboxLabel: (node) => t('editor.a11y.todo', { text: node.textContent || t('editor.a11y.todoEmpty') }) },
    }),
    w(
      'details',
      MarkdownDetails.configure({
        persist: true,
        HTMLAttributes: { class: 'toggle' },
        renderToggleButton: ({ element, isOpen }: { element: HTMLElement; isOpen: boolean }) => {
          element.setAttribute('aria-label', t(isOpen ? 'editor.a11y.collapse' : 'editor.a11y.expand'))
          element.setAttribute('aria-expanded', String(isOpen))
        },
      }),
    ),
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
