/** Paste (Markdown, URLs) and link-click handling. */
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { navigate } from '../../lib/router'
import { useUI } from '../../store/ui'
import type { Bridge } from '../lib/bridge'
import { isUrl } from '../lib/embeds'
import { looksLikeMarkdown, markdownToDoc } from '../convert'

/** HTML that carries no real structure (e.g. code editors wrap text in divs/spans). */
function htmlIsPlainish(html: string): boolean {
  return !/<(p|h[1-6]|li|ul|ol|table|blockquote|pre|img|strong|b|em|a)\b/i.test(html)
}

export function pasteExtension(bridge: Bridge | null) {
  return Extension.create({
    name: 'onePaste',
    priority: 1100,
    addProseMirrorPlugins() {
      const editor = this.editor
      return [
        new Plugin({
          key: new PluginKey('onePaste'),
          props: {
            // the "Paste as" menu keeps focus in the editor; it only claims ↑ ↓ ↵ while open
            handleKeyDown(_view, event) {
              if (!bridge?.getState().urlPaste) return false
              return bridge.keyHandlers.urlPaste?.(event) ?? false
            },
            handlePaste(view, event) {
              const data = event.clipboardData
              if (!data || !editor.isEditable || !bridge) return false
              if (data.files && data.files.length > 0) return false
              const { state } = view
              if (state.selection.$from.parent.type.spec.code) return false
              const text = data.getData('text/plain')
              const html = data.getData('text/html')
              if (!text) return false

              // single URL
              if (isUrl(text)) {
                if (!state.selection.empty) return false // Link extension turns the selection into a link
                const url = text.trim()
                const $from = state.selection.$from
                const wasEmpty = $from.parent.type.name === 'paragraph' && $from.parent.content.size === 0
                const from = state.selection.from
                const tr = state.tr.replaceSelectionWith(state.schema.text(url, [state.schema.marks.link.create({ href: url })]), false)
                tr.setStoredMarks([])
                view.dispatch(tr)
                if (wasEmpty) bridge.setState({ urlPaste: { url, from, to: from + url.length } })
                return true
              }

              // markdown text
              if ((!html || htmlIsPlainish(html)) && looksLikeMarkdown(text)) {
                const doc = markdownToDoc(text)
                const content = doc.content ?? []
                if (!content.length) return false
                const single = content.length === 1 && content[0].type === 'paragraph'
                return editor.commands.insertContent(single ? (content[0].content ?? []) : content, { updateSelection: true })
              }
              return false
            },
            handleDOMEvents: {
              click(view, event) {
                const target = event.target as HTMLElement | null
                const a = target?.closest?.('a[href]') as HTMLAnchorElement | null
                if (!a || !view.dom.contains(a) || event.button !== 0) return false
                if (a.closest('[data-node-view-wrapper], .node-view')) return false
                if (!window.getSelection()?.isCollapsed) return false
                const href = a.getAttribute('href') ?? ''
                const m = href.match(/^#\/p\/([\w-]+)/)
                event.preventDefault()
                if (m) {
                  if (event.altKey) useUI.getState().openPane(m[1])
                  else navigate(href)
                  return true
                }
                if (/^(https?:|mailto:|tel:)/i.test(href)) window.open(href, '_blank', 'noopener,noreferrer')
                return true
              },
            },
          },
        }),
      ]
    },
  })
}
