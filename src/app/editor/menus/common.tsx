import { useEffect, useMemo, useRef } from 'react'
import type { Editor } from '@tiptap/core'
import type { VirtualElement } from '@floating-ui/react'
import { posToDOMRect } from '@tiptap/core'
import type { Bridge, SuggestState } from '../lib/bridge'

/** Virtual anchor following the suggestion decoration ("/query"). */
export function useSuggestAnchor(editor: Editor, suggest: SuggestState | null): VirtualElement | null {
  const ref = useRef(suggest)
  ref.current = suggest
  return useMemo<VirtualElement | null>(
    () =>
      suggest
        ? {
            contextElement: editor.view.dom,
            getBoundingClientRect: () => {
              const s = ref.current
              const r = s?.rect()
              if (r && (r.width || r.height)) return r
              try {
                return posToDOMRect(editor.view, s?.range.from ?? 0, s?.range.to ?? 0)
              } catch {
                return new DOMRect()
              }
            },
          }
        : null,
    // re-create only when a suggestion session starts/stops
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [!!suggest, suggest?.kind, editor],
  )
}

/** Virtual anchor at a document position. */
export function posAnchor(editor: Editor, from: number, to = from): VirtualElement {
  return {
    contextElement: editor.view.dom,
    getBoundingClientRect: () => {
      try {
        const size = editor.state.doc.content.size
        return posToDOMRect(editor.view, Math.min(from, size), Math.min(to, size))
      } catch {
        return new DOMRect()
      }
    },
  }
}

/**
 * Keyboard bridge for suggestion menus: the ProseMirror plugin forwards keydown here.
 * Up/Down move, Enter/Tab select.
 */
export function useSuggestKeys(bridge: Bridge, opts: { count: number; active: number; setActive: (n: number) => void; onSelect: (i: number) => void; columns?: number }) {
  const ref = useRef(opts)
  ref.current = opts
  useEffect(() => {
    bridge.keyHandler = (e) => {
      const { count, active, setActive, onSelect, columns = 1 } = ref.current
      if (e.isComposing) return false
      if (e.key === 'ArrowDown') {
        if (!count) return false
        setActive((active + columns) % Math.max(count, 1))
        return true
      }
      if (e.key === 'ArrowUp') {
        if (!count) return false
        setActive((active - columns + count * columns) % Math.max(count, 1))
        return true
      }
      if (columns > 1 && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
        if (!count) return false
        setActive((active + (e.key === 'ArrowRight' ? 1 : -1) + count) % count)
        return true
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        if (!count) return false
        onSelect(active)
        return true
      }
      return false
    }
    return () => {
      bridge.keyHandler = null
    }
  }, [bridge])
}

/** Keep the active row visible. */
export function useScrollActive(listRef: React.RefObject<HTMLElement | null>, active: number) {
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active, listRef])
}
