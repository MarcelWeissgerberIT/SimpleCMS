/**
 * Building blocks — what a person types into a property of an own type: its `validate` script checks the
 * value first (query mode; true / null = fine, a text = refused with that message — the value is NOT
 * written, the message shows at the cell), then the value is written the way a cell writes it, then its
 * `onChange` script runs (run mode: `value`, `old`, `row`; mail / Claude / web and the trash are asked
 * like any script run). Properties without those scripts are written at once.
 */
import { create } from 'zustand'
import { useWorkspace } from '../../store/store'
import { toast } from '../../store/ui'
import type { Database, ID, PropertyDef, PropertyValue } from '../../store/types'
import { t } from '../../i18n'
import { writePropertyValue } from '../../database'
import { ownTypeOf } from './model'
import { refusalOf, runBinding, runError, untrustedOf } from './scripts'
import { openReview } from './review'

/** A refusal shown at a cell (KitHost renders it). */
export interface Refusal {
  id: number
  message: string
  /** the cell's box when the value was refused (null: shown as a toast) */
  rect: { x: number; y: number; width: number; height: number } | null
}

export const useRefusals = create<{ list: Refusal[] }>()(() => ({ list: [] }))
let seq = 0

export function showRefusal(message: string, anchor?: Element | null): void {
  const r = anchor?.isConnected ? anchor.getBoundingClientRect() : null
  if (!r) {
    toast({ message, timeout: 5000 })
    return
  }
  const id = ++seq
  useRefusals.setState((s) => ({ list: [...s.list.slice(-2), { id, message, rect: { x: r.x, y: r.y, width: r.width, height: r.height } }] }))
  window.setTimeout(() => dismissRefusal(id), 5000)
}

export const dismissRefusal = (id: number) => useRefusals.setState((s) => ({ list: s.list.filter((r) => r.id !== id) }))

/** Does writing this property need the kit (a validate or onChange script)? */
export function kitChecksWrite(prop: PropertyDef): boolean {
  const s = ownTypeOf(prop)?.scripts
  return !!(s?.validate || s?.onChange)
}

/** A value script computes this property: nobody types into it. */
export function isKitComputed(prop: PropertyDef): boolean {
  return !!ownTypeOf(prop)?.scripts?.value
}

/**
 * Write a value a person entered (cells, the row page's panel, bulk edits) into rows. Plain properties:
 * written at once (true). Own types: validated, written, onChange — resolves with whether it was written
 * (to at least one row).
 */
export async function writeUserValue(db: Database, prop: PropertyDef, rowIds: ID[], value: PropertyValue, anchor?: Element | null): Promise<boolean> {
  const type = ownTypeOf(prop)
  if (type?.scripts?.value) {
    showRefusal(t('features.kit.computed.readOnly', { name: prop.name }), anchor)
    return false
  }
  if (!type || !kitChecksWrite(prop)) {
    for (const id of rowIds) writePropertyValue(db.id, prop, id, value)
    return true
  }
  const untrusted = untrustedOf(type)
  if (untrusted.length) {
    // team: someone else's version of the scripts does not run here — the value is written unchecked
    toast({ message: t('features.kit.trust.skipped', { name: type.name }), action: { label: t('features.kit.trust.review'), run: () => openReview(type.id) } })
  }
  const written: Array<{ rowId: ID; old: PropertyValue }> = []
  let refused: string | null = null
  let nRefused = 0
  for (const rowId of rowIds) {
    const row = useWorkspace.getState().pages[rowId]
    if (!row) continue
    if (type.scripts?.validate && !untrusted.includes('validate')) {
      const r = await runBinding(type, 'validate', { row, prop, value }, { mode: 'query' })
      if (r && r !== 'untrusted') {
        const no = r.ok ? refusalOf(r.plain) : t('features.kit.validate.failed', { msg: r.error ?? '' })
        if (no) {
          refused = refused ?? no
          nRefused++
          continue
        }
      }
    }
    const old = (useWorkspace.getState().pages[rowId]?.properties[prop.id] ?? null) as PropertyValue
    writePropertyValue(db.id, prop, rowId, value)
    written.push({ rowId, old })
  }
  if (refused) showRefusal(nRefused > 1 ? t('features.kit.validate.refusedRows', { n: nRefused, msg: refused }) : refused, anchor)
  if (type.scripts?.onChange && !untrusted.includes('onChange')) {
    for (const { rowId, old } of written) {
      const row = useWorkspace.getState().pages[rowId]
      if (!row || JSON.stringify(old) === JSON.stringify(value)) continue
      const r = await runBinding(type, 'onChange', { row, prop, value, old }, { mode: 'run' })
      if (r && r !== 'untrusted' && !r.ok && r.result.status !== 'cancelled') toast({ message: t('features.kit.onChange.failed', { name: type.name, msg: runError(r.result) }), timeout: 6000 })
    }
  }
  return written.length > 0
}
