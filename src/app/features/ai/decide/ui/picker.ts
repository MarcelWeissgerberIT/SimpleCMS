/**
 * The Vorprüfer picker's rows (section 06, setup step 03, Settings › AI): the decision models of OpenRouter's catalogue —
 * the Jev family selectable (pinned versions, newest first), every other decision model listed dimmed, "tuned for Jev
 * only" (owner decision 2). The catalogue is read on demand only (never at boot): `useDecisionRows(true)`.
 */
import { useEffect, useState } from 'react'
import type { DecisionRow } from '@/shared/ai/catalog'
import type { Lang } from '@/shared/i18n'
import { JEV_CHECK_TOKENS, canonicalOf, isJevModel, jevLabel, jevSnapshotDay, jevVersion, newestJev } from '@/shared/ai/jev'
import type { MenuEntry } from '../../../../ui/Menu'
import { fmtCost } from '../../../../lib/money'
import { decisionRows } from '../../core/decisionRows'

type T = (key: string, vars?: Record<string, string | number>) => string

export type RowsState = 'idle' | 'loading' | 'ready' | 'failed'

/** The decision models this tab knows — read once when `enabled` turns true (one public GET when none is kept). */
export function useDecisionRows(enabled: boolean): { rows: readonly DecisionRow[]; state: RowsState } {
  const [rows, setRows] = useState<readonly DecisionRow[]>(() => decisionRows().rows)
  const [state, setState] = useState<RowsState>(() => (decisionRows().rows.length ? 'ready' : 'idle'))
  useEffect(() => {
    if (!enabled) return
    let alive = true
    setState((s) => (s === 'ready' ? s : 'loading'))
    void import('../../core/catalog')
      .then((m) => m.loadDecisionCatalog())
      .then((c) => {
        if (!alive) return
        if (c?.rows.length) {
          setRows(c.rows)
          setState('ready')
        } else setState('failed')
      })
      .catch(() => alive && setState('failed'))
    return () => {
      alive = false
    }
  }, [enabled])
  return { rows, state }
}

const priceFmt = new Map<Lang, Intl.NumberFormat>()
/** "0,042 $ per M in · output free" */
export function priceText(t: T, lang: Lang, row: DecisionRow | null | undefined): string {
  if (!row?.price) return ''
  let f = priceFmt.get(lang)
  if (!f) priceFmt.set(lang, (f = new Intl.NumberFormat(lang === 'de' ? 'de-DE' : 'en-US', { maximumFractionDigits: 4 })))
  return t('features.ai.jev.pick.price', { in: f.format(row.price.input) })
}

/** "≈ $0.00005" per check (null: no price known). */
export function perCheck(lang: Lang, row: DecisionRow | null | undefined): string | null {
  if (!row?.price) return null
  return `≈ ${fmtCost((row.price.input * JEV_CHECK_TOKENS) / 1e6, lang)}`
}

/** The Jev rows, newest first, then the other decision models (dimmed). */
export function sortedRows(rows: readonly DecisionRow[]): { jev: DecisionRow[]; other: DecisionRow[] } {
  const jev = rows.filter((r) => isJevModel(r.id) && !r.refused)
  jev.sort((a, b) => {
    const x = jevVersion(a.id) ?? []
    const y = jevVersion(b.id) ?? []
    for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (y[i] ?? 0) - (x[i] ?? 0)
    return 0
  })
  return { jev, other: rows.filter((r) => !jev.includes(r)) }
}

/** The row of a Jev version (null: not in the catalogue this tab knows). */
export const rowOf = (rows: readonly DecisionRow[], id: string | null | undefined): DecisionRow | null => (id ? (rows.find((r) => r.id === id) ?? null) : null)

/** The confirmed key for a version: `openrouter:` + its catalogue snapshot (the dated canonical slug), else the version. */
export const onKeyOf = (rows: readonly DecisionRow[], id: string): string => {
  const row = rowOf(rows, id)
  return `openrouter:${row ? canonicalOf(row) : id}`
}

export { newestJev }

/** A snapshot's day in the UI's language ("17.09.2026" · "Sep 17, 2026"); '' when undated. */
export function snapshotDate(id: string, lang: Lang): string {
  const day = jevSnapshotDay(id.replace(/^openrouter:/, ''))
  if (!day) return ''
  return new Date(`${day}T12:00:00`).toLocaleDateString(lang === 'de' ? 'de-DE' : 'en-US', { year: 'numeric', month: lang === 'de' ? '2-digit' : 'short', day: '2-digit' })
}

/**
 * The picker's entries: `inherit` first when given (the class rule decides), the Jev versions (the current one ticked),
 * then the other decision models — never selectable, "tuned for Jev only".
 */
export function pickerEntries(t: T, lang: Lang, o: { rows: readonly DecisionRow[]; state: RowsState; current: string | null; onPick: (id: string | null) => void; inherit?: string; inheritOff?: boolean }): MenuEntry[] {
  const { jev, other } = sortedRows(o.rows)
  const out: MenuEntry[] = [{ kind: 'section', label: t('features.ai.jev.pick.title') }]
  // `inheritOff`: the rules name no Jev version whose row is read (its snapshot could not be confirmed) — listed, not picked
  if (o.inherit !== undefined) out.push({ id: 'inherit', label: o.inherit, checked: o.current === null, ...(o.inheritOff ? { disabled: true } : {}), onSelect: () => o.onPick(null) })
  for (const r of jev) {
    const date = snapshotDate(canonicalOf(r), lang)
    out.push({ id: r.id, label: jevLabel(r.id), hint: [priceText(t, lang, r), date ? t('features.ai.jev.pick.snapshot', { date }) : ''].filter(Boolean).join(' · '), checked: o.current === r.id, onSelect: () => o.onPick(r.id) })
  }
  if (!jev.length) out.push({ id: 'none', label: o.state === 'loading' ? t('features.ai.jev.pick.loading') : o.state === 'failed' ? t('features.ai.jev.pick.failed') : t('features.ai.jev.pick.empty'), disabled: true })
  if (other.length) {
    out.push({ kind: 'separator' })
    for (const r of other) out.push({ id: r.id, label: r.label, hint: t('features.ai.jev.pick.jevOnly'), disabled: true })
  }
  return out
}
