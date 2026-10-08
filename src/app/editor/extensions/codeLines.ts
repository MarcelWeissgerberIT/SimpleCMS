/**
 * Code blocks: line numbers and the current line, as widget decorations (view only — the stored JSON never
 * changes). A number sits at the start of each line as an empty, absolutely positioned span whose box is the
 * code block itself (not the scrolling <pre>): it stays in the gutter while the code scrolls sideways and lands
 * on the first row of a wrapped line by itself — nothing is measured. The number is CSS (`content: attr(data-n)`),
 * so it is never copied or read out. The code block view decides whether numbers show (CodeBlockView, data-ln).
 *
 * Only the code blocks a change touched get new widgets; the rest move with the mapping. The current line is one
 * more widget where the selection's head is, while the selection is inside a code block (the view styles it only
 * while the editor has focus and can be edited), and the bracket pair at the caret gets an inline mark.
 *
 * Both widgets sit right before the caret at the start of a line, and a browser's own Backspace there deletes the
 * wrong line break: the editor deletes it itself (`deleteBreakBefore`, bound to Backspace by the code block, and
 * the `beforeinput` of keyboards that send no key, Android).
 */
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'
import { pairAt, scanBrackets } from '../../ui/code/brackets'
import type { CodeToken } from '../../ui/code/types'

const MATCH_MAX = 20_000

/** Text in quotes on one line ("…", '…', `…`, with escapes): brackets in there are not code. */
function quoted(text: string): CodeToken[] {
  const out: CodeToken[] = []
  for (let i = 0; i < text.length; i++) {
    const q = text[i]
    if (q !== '"' && q !== "'" && q !== '`') continue
    // an apostrophe inside a word is not a quote
    if (q === "'" && /\w/.test(text[i - 1] ?? '') && /\w/.test(text[i + 1] ?? '')) continue
    let j = i + 1
    while (j < text.length && text[j] !== q && text[j] !== '\n') j += text[j] === '\\' ? 2 : 1
    if (text[j] !== q) continue
    out.push({ start: i, end: j + 1, cls: 'str' })
    i = j
  }
  return out
}

const numbersKey = new PluginKey<DecorationSet>('codeLineNumbers')
const currentKey = new PluginKey('codeCurrentLine')
const backKey = new PluginKey('codeLineBackspace')

/**
 * Backspace with the caret right after a line break inside a code block (column 0 of line 2 and on): deletes that
 * break. Everything else (a selection, the block's very start) is left to the other commands.
 */
export function deleteBreakBefore(view: EditorView, type: string): boolean {
  const { selection } = view.state
  if (!selection.empty || !view.editable) return false
  const { $head } = selection
  if ($head.parent.type.name !== type || $head.parentOffset === 0) return false
  if ($head.parent.textBetween($head.parentOffset - 1, $head.parentOffset) !== '\n') return false
  view.dispatch(view.state.tr.delete($head.pos - 1, $head.pos).scrollIntoView())
  return true
}

function span(cls: string, n?: number): () => HTMLElement {
  return () => {
    const el = document.createElement('span')
    el.className = cls
    if (n !== undefined) el.dataset.n = String(n)
    el.contentEditable = 'false'
    el.setAttribute('aria-hidden', 'true')
    return el
  }
}

function numbersOf(node: PMNode, pos: number): Decoration[] {
  const text = node.textContent
  const out = [Decoration.widget(pos + 1, span('code-ln', 1), { side: -1, key: 'ln1', ignoreSelection: true })]
  let n = 1
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) {
    n++
    out.push(Decoration.widget(pos + 2 + i, span('code-ln', n), { side: -1, key: `ln${n}`, ignoreSelection: true }))
  }
  return out
}

function build(doc: PMNode, type: string): DecorationSet {
  const all: Decoration[] = []
  doc.descendants((node, pos) => {
    if (node.type.name === type) {
      all.push(...numbersOf(node, pos))
      return false
    }
    return node.isBlock
  })
  return DecorationSet.create(doc, all)
}

/** What a transaction changed, in the new document's positions. */
function changed(tr: Transaction): Array<[number, number]> {
  let ranges: Array<[number, number]> = []
  for (const map of tr.mapping.maps) {
    ranges = ranges.map(([a, b]) => [map.map(a, -1), map.map(b, 1)])
    map.forEach((_a, _b, from, to) => ranges.push([from, to]))
  }
  return ranges
}

/**
 * The plugins, added once: an extension made with .extend() (the code block's React view) carries this hook too
 * and calls it again through its parent — the second call keeps what is there.
 */
export function withCodeLines(inherited: Plugin[], type: string): Plugin[] {
  return inherited.some((p) => p.spec.key === numbersKey) ? inherited : [...inherited, ...codeLinesPlugins(type)]
}

function codeLinesPlugins(type: string): Plugin[] {
  const numbers: Plugin<DecorationSet> = new Plugin<DecorationSet>({
    key: numbersKey,
    state: {
      init: (_, state) => build(state.doc, type),
      apply(tr, set) {
        if (!tr.docChanged) return set
        const ranges = changed(tr)
        // a step without a range (attributes only) or a whole-document change: draw everything again
        if (!ranges.length || ranges.some(([a, b]) => a <= 0 && b >= tr.doc.content.size)) return build(tr.doc, type)
        let next = set.map(tr.mapping, tr.doc)
        const done = new Set<number>()
        for (const [from, to] of ranges) {
          tr.doc.nodesBetween(Math.max(0, from - 1), Math.min(tr.doc.content.size, to + 1), (node, pos) => {
            if (node.type.name !== type) return node.isBlock
            if (!done.has(pos)) {
              done.add(pos)
              next = next.remove(next.find(pos, pos + node.nodeSize)).add(tr.doc, numbersOf(node, pos))
            }
            return false
          })
        }
        return next
      },
    },
    props: {
      decorations: (state): DecorationSet | undefined => numbersKey.getState(state),
    },
  })
  const current = new Plugin({
    key: currentKey,
    props: {
      decorations(state) {
        const { $head } = state.selection
        if ($head.parent.type.name !== type || !state.selection.$anchor.sameParent($head)) return null
        const start = $head.start()
        const text = $head.parent.textContent
        const at = $head.parentOffset
        const lineStart = start + (at === 0 ? 0 : text.lastIndexOf('\n', at - 1) + 1)
        const decos = [Decoration.widget(lineStart, span('code-cur'), { side: -2, key: 'cur', ignoreSelection: true })]
        // the bracket pair at the caret (text in quotes is skipped; very long blocks are left alone)
        const lang = String($head.parent.attrs.language ?? '')
        if (state.selection.empty && text.length <= MATCH_MAX && lang !== 'markdown' && lang !== 'md') {
          const pair = pairAt(scanBrackets(text, quoted(text)), text, at)
          if (pair) for (const off of pair) decos.push(Decoration.inline(start + off, start + off + 1, { class: 'code-match' }))
        }
        return DecorationSet.create(state.doc, decos)
      },
    },
  })
  // keyboards that send no Backspace key (Android): the same for the delete the browser is about to do
  const back = new Plugin({
    key: backKey,
    props: {
      handleDOMEvents: {
        beforeinput(view, event) {
          if (event.inputType !== 'deleteContentBackward' || !event.cancelable || view.composing) return false
          if (!deleteBreakBefore(view, type)) return false
          event.preventDefault()
          return true
        },
      },
    },
  })
  return [numbers, current, back]
}
