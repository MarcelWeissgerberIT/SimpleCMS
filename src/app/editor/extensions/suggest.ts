/** Suggestion plugins ("/", "@", ":") bridged to React menus via the overlay store. */
import { Extension, type Range } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import Suggestion, { exitSuggestion } from '@tiptap/suggestion'
import type { Bridge, SuggestKind } from '../lib/bridge'

export const SUGGEST_KEYS: Record<SuggestKind, PluginKey> = {
  slash: new PluginKey('suggest-slash'),
  mention: new PluginKey('suggest-mention'),
  emoji: new PluginKey('suggest-emoji'),
}

export type SuggestRun = (range: Range) => void

export function suggestExtension(kind: SuggestKind, char: string, bridge: Bridge, extra: { allowSpaces?: boolean; minQueryLength?: number; allowedPrefixes?: string[] | null } = {}) {
  const key = SUGGEST_KEYS[kind]
  return Extension.create({
    name: `suggest-${kind}`,
    // must run before the keymaps (Enter / Tab / arrows) of other extensions
    priority: 1000,
    addProseMirrorPlugins() {
      return [
        Suggestion<unknown, SuggestRun>({
          editor: this.editor,
          pluginKey: key,
          char,
          allowSpaces: extra.allowSpaces ?? false,
          allowedPrefixes: extra.allowedPrefixes === undefined ? [' ', '(', ' '] : extra.allowedPrefixes,
          minQueryLength: extra.minQueryLength,
          decorationClass: `suggest-query suggest-query--${kind}`,
          allow: ({ state, range }) => {
            const $from = state.doc.resolve(range.from)
            if ($from.parent.type.spec.code) return false
            if (state.schema.marks.code && state.doc.rangeHasMark(range.from, range.to, state.schema.marks.code)) return false
            return true
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
                if (bridge.getState().suggest?.kind === kind) bridge.setState({ suggest: null, plusOpened: false })
              },
              onKeyDown: ({ event, view }) => {
                if (event.key === 'Escape') {
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
