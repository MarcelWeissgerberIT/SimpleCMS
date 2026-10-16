/**
 * The sidebar's drop collision (one DndContext over FAVORITES and the scroll area, PageTree.tsx `DraggableTree`).
 *
 * `visibleWithin`: a target counts only where the person can see it under the pointer. The browser's own hit test
 * (elementFromPoint) answers that: a row scrolled up under the fixed block, or one passing under a section's sticky
 * head, is covered there — the element on top (the seam, the head) is what the pointer is over. From that element the
 * nearest registered droppable ancestor is the target. Section heads (team PAGES / PRIVATE, FAVORITES) are hit live
 * too, wherever they stick — dnd-kit's own rects are measured as if everything scrolled with the list.
 *
 * The drag chip sits beside the pointer (PageTree.tsx `besideCursor`), never under it. The target's live rect goes
 * along in the collision's data (`rect`), with the pointer's live height (`y`): the before / inside / after split reads
 * both, in the same viewport space. The pointer is dnd-kit's `pointerCoordinates` (where the drag started plus how far
 * the pointer moved) — never the drag's `delta`, which also counts how far the tree scrolled since the drag began.
 */
import type { Collision, CollisionDetection } from '@dnd-kit/core'

/** The pointer's last height during a drag (viewport px), kept by every collision pass; NaN when none is known. */
let pointerAt = Number.NaN

export const visibleWithin: CollisionDetection = ({ droppableContainers, pointerCoordinates }) => {
  pointerAt = pointerCoordinates ? pointerCoordinates.y : Number.NaN
  if (!pointerCoordinates) return []
  const hit = document.elementFromPoint(pointerCoordinates.x, pointerCoordinates.y)
  if (!hit || !hit.closest('.sb')) return []
  const byNode = new Map<Element, (typeof droppableContainers)[number]>()
  for (const c of droppableContainers) {
    const node = c.node.current
    if (node && !c.disabled) byNode.set(node, c)
  }
  for (let el: Element | null = hit; el && !el.matches('.sb'); el = el.parentElement) {
    const c = byNode.get(el)
    if (!c) continue
    const rect = el.getBoundingClientRect()
    const out: Collision = { id: c.id, data: { droppableContainer: c, value: 0, rect, y: pointerCoordinates.y } }
    return [out]
  }
  return []
}

/** The live rect a collision carries (visibleWithin), else null. */
export function liveRect(collisions: Collision[] | null | undefined): DOMRect | null {
  const r = collisions?.[0]?.data?.rect
  return r instanceof DOMRect ? r : null
}

/** Where the pointer is now (viewport px): the collision's own reading, else the last pass's; NaN before any. */
export function livePointerY(collisions?: Collision[] | null): number {
  const y = collisions?.[0]?.data?.y
  return typeof y === 'number' ? y : pointerAt
}

/** A drag ended: no pointer height is known until the next one. */
export function forgetPointer(): void {
  pointerAt = Number.NaN
}
