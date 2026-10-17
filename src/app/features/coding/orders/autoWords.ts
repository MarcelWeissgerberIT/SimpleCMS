/**
 * Work orders — auto mode's fallbacks in words (Orders B11): "Nicht automatisch gestartet: 2 offene Punkte · Repo fehlt
 * bei 02". Pure over a passed translator and a title lookup (a Node spec reads it); a page a reason names is the request
 * itself ("der Auftrag …") or a page by its title.
 */
import type { ID } from '../../../store/types'
import { stepNo } from './words'
import type { OrderAutoWhy } from './types'

type Tr = (key: string, vars?: Record<string, string | number>) => string
const O = 'features.coding.order'

/** One reason in words. */
export function autoWhyText(r: OrderAutoWhy, tr: Tr, o: { row: ID; titleOf: (id: ID) => string }): string {
  const page = (id: ID) => (id === o.row ? 'row' : 'page')
  switch (r.why) {
    case 'open':
      return tr(`${O}.auto.why.open.${r.n === 1 ? 'one' : 'other'}`, { n: r.n })
    case 'keys':
      return tr(`${O}.auto.why.keys.${r.n === 1 ? 'one' : 'other'}`, { n: r.n })
    case 'repo':
    case 'otherRepo':
    case 'branch':
    case 'kind':
      return tr(`${O}.auto.why.${r.why}`, { n: stepNo(r.step) })
    case 'outside':
      return tr(`${O}.auto.why.${r.cls}.${page(r.page)}`, { title: o.titleOf(r.page) })
    case 'moved':
      return tr(`${O}.auto.why.moved.${page(r.page)}`, { title: o.titleOf(r.page) })
    case 'budget':
      return tr(`${O}.auto.why.budget`)
    case 'lapsed':
      return tr(`${O}.auto.lapsed`)
    case 'fuse':
      return tr(`${O}.auto.why.fuse`, { label: r.label, path: r.path })
    case 'start':
      return r.text
  }
}

/** The plate's line: "Nicht automatisch gestartet: …" (null: nothing to say). */
export function autoFallbackText(reasons: readonly OrderAutoWhy[], tr: Tr, o: { row: ID; titleOf: (id: ID) => string }): string | null {
  if (!reasons.length) return null
  return tr(`${O}.auto.fallback`, { reasons: reasons.map((r) => autoWhyText(r, tr, o)).join(' · ') })
}
