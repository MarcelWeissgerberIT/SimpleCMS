/**
 * Building blocks in database cells — a property of an own type (PropertyDef.custom) shows its value
 * through the type's display (prefix / suffix / colour / style plain · badge · led · bar) and, when the
 * type has one, its `format` script's text. A `value` script makes the cell read-only (ƒ) and computes it
 * (recompute.ts). Failing scripts never break a table: the stored value shows with a ⚠. Team: scripts
 * this device did not save or confirm do not run — a "review" chip opens them with a Confirm key.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { ShieldAlert } from 'lucide-react'
import { useWorkspace } from '../../store/store'
import { storedTypeOf } from '../../store/kit'
import type { ColorName, CustomPropBase, CustomPropDisplay, CustomPropType, Database, ID, Page, PropertyDef, PropertyValue, SelectOption } from '../../store/types'
import { COLOR_NAMES } from '../../store/types'
import { colorText, tagStyle } from '../../lib/colors'
import { useT } from '../../i18n'
import { formatOf, optionsOf, runBinding, untrustedOf, useKitTrust, editorName, type BindingKey } from './scripts'
import { scheduleValue, setCellError, useKitErrors } from './recompute'
import { openReview } from './review'
import { itemColor } from './model'
import { newId } from '../../lib/ids'

/** The own type of a property, live (null: none, or the property no longer has its stored shape). */
export function useOwnType(prop: Pick<PropertyDef, 'custom' | 'type'>): CustomPropType | null {
  return useWorkspace((s) => {
    const type = prop.custom ? s.kit?.propTypes[prop.custom] : undefined
    return type && storedTypeOf(type.base) === prop.type ? type : null
  })
}

/** The bindings of a type that wait for this device's confirmation (re-renders when trust is known). */
export function useUntrusted(type: CustomPropType | null): BindingKey[] {
  useKitTrust((s) => s.ok)
  return untrustedOf(type)
}

/* ------------------------------------------------------------------ display */

const OPTIONISH: CustomPropBase[] = ['select', 'multi_select', 'person', 'checkbox', 'rating']

/** A value inside the type's display (also the editor's preview). */
export function DisplayFrame({ display, base, ratio, children }: { display: CustomPropDisplay | undefined; base: CustomPropBase; ratio?: number | null; children: ReactNode }) {
  const d = display ?? {}
  const style = d.style ?? 'plain'
  const color: ColorName = d.color ?? 'default'
  const chips = OPTIONISH.includes(base)
  const inner = (
    <>
      {d.prefix && <span className="kt-val__affix">{d.prefix}</span>}
      <span className="kt-val__core">{children}</span>
      {d.suffix && <span className="kt-val__affix">{d.suffix}</span>}
    </>
  )
  if (style === 'badge' && !chips)
    return (
      <span className="kt-val kt-val--badge" style={tagStyle(color)}>
        {inner}
      </span>
    )
  if (style === 'led')
    return (
      <span className="kt-val kt-val--led" style={chips ? undefined : { color: color === 'default' ? undefined : colorText(color) }}>
        <span className="kt-val__led" style={{ background: color === 'default' ? 'var(--signal)' : colorText(color) }} aria-hidden />
        {inner}
      </span>
    )
  if (style === 'bar' && base === 'number')
    return (
      <span className="kt-val kt-val--gauge">
        <span className="kt-val__track" aria-hidden>
          <span className="kt-val__fill" style={{ width: `${Math.round((ratio ?? 0) * 100)}%`, background: color === 'default' ? undefined : colorText(color) }} />
        </span>
        <span className="kt-val__text">{inner}</span>
      </span>
    )
  if (style === 'bar')
    return (
      <span className="kt-val kt-val--rule" style={{ borderColor: color === 'default' ? 'var(--signal)' : colorText(color) }}>
        {inner}
      </span>
    )
  return (
    <span className="kt-val" style={!chips && color !== 'default' ? { color: colorText(color) } : undefined}>
      {inner}
    </span>
  )
}

const ratioOf = (v: PropertyValue, prop: PropertyDef) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, prop.numberFormat === 'percent' ? v : v / 100)) : null)
const isEmpty = (v: PropertyValue | undefined) => v === null || v === undefined || v === '' || v === false || (Array.isArray(v) && !v.length)

/* ------------------------------------------------------------------ format scripts (cached) */

interface Shown {
  text?: string
  error?: string
}

const FORMAT_MAX = 3000
const formatted = new Map<string, Shown>()
const inflight = new Map<string, Promise<Shown>>()

function formatKey(code: string, row: Page, raw: PropertyValue): string {
  return `${code}\u0000${row.id}\u0000${row.updatedAt}\u0000${JSON.stringify(raw)}`
}

function useFormatted(type: CustomPropType, prop: PropertyDef, row: Page, raw: PropertyValue, blocked: boolean): Shown | null {
  const code = type.scripts?.format
  const key = code && !blocked ? formatKey(code, row, raw) : null
  const [, bump] = useState(0)
  useEffect(() => {
    if (!key || formatted.has(key)) return
    let alive = true
    let job = inflight.get(key)
    if (!job) {
      job = runBinding(type, 'format', { row, prop, value: raw }, { mode: 'query' }).then((r): Shown => {
        if (!r || r === 'untrusted') return {}
        return r.ok ? { text: formatOf(r) } : { error: r.error ?? '' }
      })
      inflight.set(key, job)
    }
    void job.then((s) => {
      inflight.delete(key)
      if (formatted.size > FORMAT_MAX) formatted.delete(formatted.keys().next().value as string)
      formatted.set(key, s)
      if (alive) bump((n) => n + 1)
    })
    return () => {
      alive = false
    }
    // the key holds everything the run depends on
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return key ? (formatted.get(key) ?? null) : null
}

/* ------------------------------------------------------------------ the cell */

export interface KitValueProps {
  db: Database
  prop: PropertyDef
  row: Page
  variant?: 'cell' | 'card' | 'panel'
  /** the base type's own rendering of the value */
  children: ReactNode
}

/** A value of an own type (database cells, cards, the row page's panel). */
export function KitValue({ db, prop, row, variant = 'cell', children }: KitValueProps) {
  const t = useT()
  const type = useOwnType(prop)
  const untrusted = useUntrusted(type)
  const raw = (row.properties[prop.id] ?? null) as PropertyValue
  const shown = useFormatted(type ?? (FALLBACK as CustomPropType), prop, row, raw, !type || untrusted.includes('format'))
  const cellError = useKitErrors((s) => s.errors[`${row.id}|${prop.id}`])
  const valueCode = type?.scripts?.value
  const computing = !!valueCode && !untrusted.includes('value')
  useEffect(() => {
    if (computing) scheduleValue(db.id, prop.id, row.id)
  }, [computing, db.id, prop.id, row.id, valueCode])
  if (!type) return <>{children}</>
  const error = cellError ?? shown?.error
  const text = shown?.text
  const showText = text !== undefined && text !== ''
  const body = showText ? <span className="kt-val__text">{text}</span> : isEmpty(raw) && prop.type !== 'checkbox' && prop.type !== 'rating' ? null : children
  return (
    <span className="kt-cell" data-kit-type={type.id} data-variant={variant}>
      {body !== null && (
        <DisplayFrame display={type.display} base={type.base} ratio={ratioOf(raw, prop)}>
          {body}
        </DisplayFrame>
      )}
      {valueCode && (
        <span className="kt-fx" title={t('features.kit.computed.title')} aria-label={t('features.kit.computed.title')}>
          ƒ
        </span>
      )}
      {error && (
        <span className="kt-warn" title={error} role="img" aria-label={t('features.kit.cell.error', { msg: error })} data-testid="kt-cell-warn">
          ⚠
        </span>
      )}
      {untrusted.length > 0 && <ReviewChip type={type} wide={variant !== 'cell'} />}
    </span>
  )
}

const FALLBACK = { id: '', name: '', base: 'text', createdAt: 0, updatedAt: 0 }

/** "Scripts changed by Ada — review": opens the code with a Confirm key. */
export function ReviewChip({ type, wide }: { type: CustomPropType; wide?: boolean }) {
  const t = useT()
  const who = editorName(type)
  const label = who ? t('features.kit.trust.chipBy', { name: who }) : t('features.kit.trust.chip')
  return (
    <button
      type="button"
      className="kt-review label"
      title={label}
      aria-label={label}
      data-testid="kt-review-chip"
      onClick={(e) => {
        e.stopPropagation()
        openReview(type.id)
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <ShieldAlert size={11} strokeWidth={2} aria-hidden />
      <span>{wide ? label : t('features.kit.trust.short')}</span>
    </button>
  )
}

/* ------------------------------------------------------------------ options scripts */

const optionCache = new Map<string, SelectOption[]>()

/**
 * The options an `options` script offers for a row (select / multi-select pickers): existing options
 * matched by name, new ones with a provisional id `kit:<name>` (ensureKitOption adds them on pick).
 * Null: no options script (or not confirmed) — the property's own options apply. Refreshed on open.
 */
export function useKitOptions(db: Database, prop: PropertyDef, rowId: ID | undefined): SelectOption[] | null {
  const type = useOwnType(prop)
  const untrusted = useUntrusted(type)
  const code = type?.scripts?.options && !untrusted.includes('options') ? type.scripts.options : null
  const key = code && rowId ? `${code}\u0000${rowId}` : null
  const [opts, setOpts] = useState<SelectOption[] | null>(() => (key ? (optionCache.get(key) ?? null) : null))
  useEffect(() => {
    if (!key || !type || !rowId) return
    let alive = true
    const row = useWorkspace.getState().pages[rowId]
    if (!row) return
    void runBinding(type, 'options', { row, prop }, { mode: 'query' }).then((r) => {
      if (!alive || !r || r === 'untrusted') return
      if (!r.ok) {
        setCellError(rowId, prop.id, r.error)
        return
      }
      const live = useWorkspace.getState().databases[db.id]?.properties.find((p) => p.id === prop.id) ?? prop
      const list = optionsOf(r.plain).map((o, i): SelectOption => {
        const hit = live.options?.find((x) => x.name.trim().toLowerCase() === o.name.toLowerCase())
        if (hit) return hit
        const color = COLOR_NAMES.includes(o.color as ColorName) ? (o.color as ColorName) : itemColor((live.options?.length ?? 0) + i)
        return { id: `kit:${o.name}`, name: o.name, color }
      })
      optionCache.set(key, list)
      setOpts(list)
    })
    return () => {
      alive = false
    }
    // refreshed each time a picker opens (mount)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return key ? opts : null
}

/**
 * The real option id for a picked one (a script's new option is added to the property first). Null: it
 * cannot be added (a locked database, options from a list).
 */
export function ensureKitOption(db: Database, prop: PropertyDef, option: SelectOption): ID | null {
  if (!option.id.startsWith('kit:')) return option.id
  const s = useWorkspace.getState()
  const live = s.databases[db.id]?.properties.find((p) => p.id === prop.id)
  if (!live) return null
  const hit = live.options?.find((o) => o.name.trim().toLowerCase() === option.name.toLowerCase())
  if (hit) return hit.id
  if (s.databases[db.id]?.locked || live.listId) return null
  const id = newId()
  s.updateProperty(db.id, prop.id, { options: [...(live.options ?? []), { id, name: option.name, color: option.color }] })
  return id
}
