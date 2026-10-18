/**
 * Work orders — the built-in database command "Planen" / "Plan" (features/commands defaults.ts, group 'orders',
 * `needsRow`): a press of the allow-list for each picked request (≤ 5), or for the request on screen (sidebar, ⌘K).
 * Its outcome line names each request; a refusal of every one is the command's failure. With Coding off on this device
 * the press is kept like any other (it plans once Coding is on and the worker connects — §3.1).
 */
import type { ID } from '../../../store/types'
import { t } from '../../../i18n'
import { orderCode, orderRowIds } from './db'
import { pressPlan, pressProv } from './press'
import { preWhyText } from './text'
import { ORDER_LIMITS } from './types'
import { useWorkspace } from '../../../store/store'

export class OrderCommandError extends Error {
  constructor(
    message: string,
    readonly fix: 'settings' | null = null,
  ) {
    super(message)
  }
}

/**
 * Plan these requests of `dbId` (`here`: the page on screen, taken when nothing is picked). Resolves the outcome line;
 * throws OrderCommandError when nothing was pressed (no row, too many, every one refused).
 */
export async function planRows(dbId: ID, rowIds: ID[], here: ID | null): Promise<string> {
  const live = new Set(orderRowIds())
  const rows = (rowIds.length ? rowIds : here ? [here] : []).filter((id) => live.has(id) && useWorkspace.getState().pages[id]?.databaseId === dbId)
  if (!rows.length) throw new OrderCommandError(t('features.coding.order.cmd.err.pickRow'))
  if (rows.length > ORDER_LIMITS.rowsPerCommand) throw new OrderCommandError(t('features.coding.order.cmd.err.tooMany', { n: ORDER_LIMITS.rowsPerCommand }))
  // the provenance of every row first, at the press (before any of them writes its Status)
  const captured = new Map(rows.map((id) => [id, pressProv(useWorkspace.getState().pages, id)]))
  const out: string[] = []
  let pressed = 0
  let lastWhy = ''
  for (const id of rows) {
    const r = await pressPlan(id, 'command', { captured: captured.get(id) })
    const code = orderCode(id) ?? (useWorkspace.getState().pages[id]?.title.trim() || t('common.untitled'))
    if (r.kind === 'planning') {
      pressed++
      out.push(t('features.coding.order.cmd.res.planning', { id: code }))
    } else if (r.kind === 'asked') {
      // Orders B12 — a team device without the worker link: asked for on the worker device (its card plans it)
      pressed++
      out.push(t('features.coding.order.cmd.res.asked', { id: code }))
    } else if (r.kind === 'kept') {
      // kept on this device (§3.1): with Coding off it waits for Coding and the worker
      pressed++
      out.push(t(r.why === 'codingOff' ? 'features.coding.order.cmd.res.keptOff' : 'features.coding.order.cmd.res.kept', { id: code }))
    } else {
      lastWhy = preWhyText(r.why, r.left)
      out.push(t('features.coding.order.cmd.res.refused', { id: code, why: lastWhy }))
    }
  }
  if (!pressed) throw new OrderCommandError(rows.length === 1 ? lastWhy : out.join(' · '))
  return out.join(' · ')
}
