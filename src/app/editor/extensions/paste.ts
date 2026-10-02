/** Paste (Markdown, URLs) and link-click handling. */
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Fragment, Slice } from '@tiptap/pm/model'
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
                const tr = state.tr.insertText(url, from)
                tr.addMark(from, from + url.length, state.schema.marks.link.create({ href: url }))
                tr.removeStoredMark(state.schema.marks.link)
                view.dispatch(tr)
                if (wasEmpty) bridge.setState({ urlPaste: { url, from, to: from + url.length } })
                return true
              }

              // markdown text
              if ((!html || htmlIsPlainish(html)) && looksLikeMarkdown(text)) {
                const doc = markdownToDoc(text)
                const content = doc.content ?? []
                try {
                  const nodes = content.map((c) => state.schema.nodeFromJSON(c))
                  const fragment = Fragment.fromArray(nodes)
                  const single = nodes.length === 1 && nodes[0].type.name === 'paragraph'
                  const slice = single ? new Slice(fragment, 1, 1) : new Slice(fragment, 0, 0)
                  view.dispatch(state.tr.replaceSelection(slice).scrollIntoView())
                  return true
                } catch (err) {
                  console.warn('[editor] markdown paste failed', err)
                  return false
                }
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
