/**
 * The lamps' keys in the DOM (plan §3.7, §3.9): every lamp's key carries `data-pb-lamp="<n>"` (0–6) and, for 04–06,
 * `data-pb-recipe="<recipe id>"` — the setup band, the strip and the phone's vertical lamps (B12) render them; the
 * arrival, the dialogs' "after" and the band's own focus moves find a lamp's key by them, and nothing else.
 * Focus lands on a key only while nobody else has the keyboard (the body, the main region, the element it went back to,
 * a view's landing point — its heading with tabindex -1, where a page puts the keyboard when nobody has it).
 */
import { canFocus, focusIsNowhere, restoreFocus } from '../../../ui/focus'
import type { SetupLamp } from '../types'

const INTERACTIVE = 'input, textarea, select, button, a[href], [contenteditable="true"], [role="button"], [role="menuitem"], [role="option"], [role="tab"]'

/** Nobody has the keyboard but a landing point: the body, the main region, `from`, an element gone, a heading the view focused. */
function free(a: Element | null, from: Element | null | undefined): boolean {
  if (!a || !a.isConnected || a === from || focusIsNowhere(a)) return true
  return a instanceof HTMLElement && a.tabIndex < 0 && !a.matches(INTERACTIVE)
}

/** The selector of a lamp's key. */
export function lampKeySelector(n: number, recipe?: string | null): string {
  const r = n >= 4 && recipe ? `[data-pb-recipe="${CSS.escape(recipe)}"]` : ''
  return `[data-pb-lamp="${n}"]${r}`
}

/** A lamp's key in the document now (null: not shown). */
export const lampKey = (n: number, recipe?: string | null): HTMLElement | null => document.querySelector<HTMLElement>(lampKeySelector(n, recipe))

/**
 * Focus a lamp's key once it shows (the band renders a moment after a route change or a store write): ≤ `waitMs`.
 * `from`: the key focus went back to (a dialog's opener) — it gives the keyboard on; focus the person moved anywhere
 * else meanwhile is theirs. True when the key took the focus.
 */
export function focusLampKey(lamp: Pick<SetupLamp, 'n' | 'recipe'>, opts: { waitMs?: number; from?: Element | null } = {}): Promise<boolean> {
  const until = performance.now() + (opts.waitMs ?? 2000)
  return new Promise((resolve) => {
    const tick = () => {
      const key = lampKey(lamp.n, lamp.recipe)
      if (!canFocus(key)) {
        if (performance.now() < until) requestAnimationFrame(tick)
        else resolve(false)
        return
      }
      const a = document.activeElement
      if (a !== key && !free(a, opts.from)) return resolve(false)
      restoreFocus(key)
      resolve(document.activeElement === key)
    }
    requestAnimationFrame(tick)
  })
}
