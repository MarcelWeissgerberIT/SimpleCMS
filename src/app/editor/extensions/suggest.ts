/** Suggestion plugins ("/", "@", ":", "one:") bridged to React menus via the overlay store. */
import { Extension, type Range } from '@tiptap/core'
import { Plugin, PluginKey, Selection, type EditorState, type Transaction } from '@tiptap/pm/state'
import { ReplaceStep } from '@tiptap/pm/transform'
import type { EditorView } from '@tiptap/pm/view'
import Suggestion, { exitSuggestion } from '@tiptap/suggestion'
import type { Bridge, SuggestKind } from '../lib/bridge'

export const SUGGEST_KEYS: Record<SuggestKind, PluginKey> = {
  slash: new PluginKey('suggest-slash'),
  mention: new PluginKey('suggest-mention'),
  emoji: new PluginKey('suggest-emoji'),
  ref: new PluginKey('suggest-ref'),
}

export type SuggestRun = (range: Range) => void

/**
 * Where the trigger character was just typed (or put there by the "+" button) — a menu opens only there, like
 * Notion: moving the caret into existing text such as "/r/24772", "@home" or " :x" never opens one. Pastes and
 * drops don't arm; a caret move out of the line disarms.
 */
function armPlugin(key: PluginKey<number | null>, suggestKey: PluginKey, char: string) {
  return new Plugin<number | null>({
    key,
    state: {
      init: () => null,
      apply(tr: Transaction, prev: number | null): number | null {
        // Esc / dismissed: the same "/" doesn't open the menu again
        if ((tr.getMeta(suggestKey) as { exit?: boolean } | undefined)?.exit) return null
        let armed = prev
        if (armed !== null && tr.docChanged) {
          const m = tr.mapping.mapResult(armed, 1)
          armed = m.deletedAfter ? null : m.pos
        }
        if (tr.docChanged && !tr.getMeta('paste') && !['paste', 'drop'].includes(tr.getMeta('uiEvent'))) {
          tr.steps.forEach((step, i) => {
            if (!(step instanceof ReplaceStep) || step.slice.size < 1) return
            const text = step.slice.content.textBetween(0, step.slice.content.size)
            if (!text.endsWith(char.slice(-1))) return
            const end = tr.mapping.slice(i + 1).map(step.from + step.slice.size)
            // a trigger of several characters ("one:") is armed by its last one, typed right after the rest
            if (char.length > 1 && tr.doc.textBetween(Math.max(0, end - char.length), end) !== char) return
            if (tr.selection.empty && tr.selection.head === end) armed = end - char.length
          })
        } else if (armed !== null && tr.selectionSet && !tr.docChanged) {
          const $head = tr.selection.$head
          if (armed >= tr.doc.content.size || $head.pos <= armed || !$head.sameParent(tr.doc.resolve(armed))) armed = null
        }
        return armed
      },
    },
  })
}

const armedAt = (key: PluginKey<number | null>, state: EditorState) => key.getState(state) ?? null

/** Slash menu opened via the "+" button and dismissed: remove the "/" again (and the line "+" created). */
export function dismissPlusSlash(view: EditorView, bridge: Bridge, range: Range) {
  const { plusOpened, plusCreated } = bridge.getState()
  if (!plusOpened) return
  const { state } = view
  if (range.to > state.doc.content.size || state.doc.textBetween(range.from, Math.min(range.from + 1, range.to)) !== '/') return
  const tr = state.tr.delete(range.from, range.to)
  const $pos = tr.doc.resolve(tr.mapping.map(range.from))
  if (plusCreated && $pos.parent.type.name === 'paragraph' && $pos.parent.content.size === 0 && $pos.depth >= 1 && $pos.node(-1).childCount > 1) {
    const before = $pos.before()
    tr.delete(before, $pos.after())
    tr.setSelection(Selection.near(tr.doc.resolve(Math.max(0, before - 1)), -1))
  }
  bridge.setState({ plusOpened: false, plusCreated: false })
  view.dispatch(tr)
}

export function suggestExtension(
  kind: SuggestKind,
  char: string,
  bridge: Bridge,
  extra: { allowSpaces?: boolean; allowedPrefixes?: string[] | null; shouldShow?: (query: string) => boolean } = {},
) {
  const key = SUGGEST_KEYS[kind]
  const armKey = new PluginKey<number | null>(`suggest-${kind}-armed`)
  return Extension.create({
    name: `suggest-${kind}`,
    // must run before the keymaps (Enter / Tab / arrows) of other extensions
    priority: 1000,
    addProseMirrorPlugins() {
      return [
        // before the suggestion plugin: its state is read in `allow` of the same transaction
        armPlugin(armKey, key, char),
        Suggestion<unknown, SuggestRun>({
          editor: this.editor,
          pluginKey: key,
          char,
          allowSpaces: extra.allowSpaces ?? false,
          allowedPrefixes: extra.allowedPrefixes === undefined ? [' ', '(', ' '] : extra.allowedPrefixes,
          shouldShow: extra.shouldShow ? ({ query }) => extra.shouldShow!(query) : undefined,
          decorationClass: `suggest-query suggest-query--${kind}`,
          allow: ({ state, range, isActive }) => {
            const $from = state.doc.resolve(range.from)
            if ($from.parent.type.spec.code) return false
            if (state.schema.marks.code && state.doc.rangeHasMark(range.from, range.to, state.schema.marks.code)) return false
            // a path or reference ("/r/24772", "/api/v1") is no command
            if (kind === 'slash' && state.doc.textBetween(range.from + 1, range.to).includes('/')) return false
            return !!isActive || armedAt(armKey, state) === range.from
          },
          items: () => [],
          command: ({ range, props }) => props(range),
          render: () => {
            const push = (p: { query: string; range: Range; clientRect?: (() => DOMRect | null) | null; command: (r: SuggestRun) => void }) =>
              bridge.setState({
                suggest: {
                  kind,
                  query: p.query,
                  range: p.range,
                  rect: () => p.clientRect?.() ?? null,
                  command: (run) => p.command(run as SuggestRun),
                },
              })
            return {
              onStart: push,
              onUpdate: push,
              onExit: () => {
                if (bridge.getState().suggest?.kind === kind) bridge.setState({ suggest: null, plusOpened: false, plusCreated: false })
              },
              onKeyDown: ({ event, view, range }) => {
                if (event.key === 'Escape') {
                  if (kind === 'slash') dismissPlusSlash(view, bridge, range)
                  exitSuggestion(view, key)
                  return true
                }
                return bridge.keyHandlers[kind]?.(event) ?? false
              },
            }
          },
        }),
      ]
    },
  })
}
