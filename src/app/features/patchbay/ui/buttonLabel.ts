/**
 * A button block's label, read from its page's content (the model keeps ids only): the rack's button module and the
 * static picture name a button by what it says ("Wochenbericht"), the page beside it.
 */

/** The label of the button block `block` in a page's TipTap JSON (null: not there, or no label). */
export function buttonLabelIn(doc: unknown, block: string): string | null {
  if (!doc || typeof doc !== 'object') return null
  const node = doc as { type?: string; attrs?: { id?: string; label?: unknown }; content?: unknown[] }
  if (node.type === 'button' && node.attrs?.id === block) return typeof node.attrs.label === 'string' ? node.attrs.label : null
  for (const c of node.content ?? []) {
    const hit = buttonLabelIn(c, block)
    if (hit !== null) return hit
  }
  return null
}
