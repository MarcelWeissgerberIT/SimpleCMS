/**
 * What goes into a slot: a parameter, a value (number, text, yes / no), an operator (keys) or a
 * function (built-ins by category with their signature, plus the workspace's own functions).
 * One search field on top doubles as quick entry: "42" offers the number 42, "abc" the text.
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Popover } from '../../../ui/Popover'
import { useT, useLang } from '../../../i18n'
import type { FnParam } from '../../../store/types'
import { CATEGORY_ORDER, OPERATOR_KEYS, type Catalog } from './catalog'
import { signature, type CallSpec } from './model'

export type Choice = { k: 'param'; name: string } | { k: 'num'; v: number | null } | { k: 'str'; v: string | null } | { k: 'bool'; v: boolean } | { k: 'call'; spec: CallSpec }

interface Option {
  id: string
  section: 'value' | 'param' | 'op' | 'fn'
  choice: Choice
  face: ReactNode
  hint?: string
}

export interface NodePickerProps {
  anchor: HTMLElement
  mode: 'fill' | 'wrap'
  params: FnParam[]
  catalog: Catalog
  /** the function being built (offered too: recursion is allowed, and capped) */
  self: CallSpec | null
  initialQuery?: string
  onPick: (c: Choice) => void
  onClose: () => void
}

const YES = /^(yes|true|ja|wahr|y|j)$/i
const NO = /^(no|false|nein|falsch|n)$/i
const NUM = /^[-+]?(\d+([.,]\d*)?|[.,]\d+)(e[-+]?\d+)?$/i

export const describe = (spec: CallSpec, lang: 'en' | 'de'): string => (typeof spec.description === 'string' ? spec.description : (spec.description?.[lang] ?? ''))

export function NodePicker({ anchor, mode, params, catalog, self, initialQuery = '', onPick, onClose }: NodePickerProps) {
  const t = useT()
  const lang = useLang()
  const listId = useId()
  const [query, setQuery] = useState(initialQuery)
  const [cat, setCat] = useState<string>(() => (catalog.customs.length ? 'custom' : 'math'))
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  // focus the field right away: a key typed just after opening (e.g. "3" then ⏎) must land in it
  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.focus({ preventScroll: true })
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])

  const customs = useMemo(() => (self && self.name ? [...catalog.customs.filter((c) => c.name !== self.name), self] : catalog.customs), [catalog.customs, self])
  const categories = useMemo(() => {
    const present = new Set(catalog.builtins.map((b) => b.category))
    const list = CATEGORY_ORDER.filter((c) => present.has(c))
    for (const c of present) if (!list.includes(c)) list.push(c)
    return customs.length ? ['custom', ...list] : list
  }, [catalog.builtins, customs.length])

  const options = useMemo<Option[]>(() => {
    const q = query.trim()
    const qu = q.toUpperCase()
    const ql = q.toLowerCase()
    const out: Option[] = []
    const fnOption = (s: CallSpec): Option => ({
      id: `fn:${s.name}`,
      section: 'fn',
      choice: { k: 'call', spec: s },
      face: (
        <>
          <span className="fx-pick__name">{s.name}</span>
          <span className="fx-pick__sig">
            {signature(
              '',
              s.args.map((a, i) => ({
                name: a.optional || a.repeat ? `[${a.name}${a.repeat && i === s.args.length - 1 ? '…' : ''}]` : a.name,
              })),
            )}
          </span>
        </>
      ),
      hint: describe(s, lang),
    })
    const opOption = (s: CallSpec): Option => {
      const k = OPERATOR_KEYS[s.name as keyof typeof OPERATOR_KEYS]
      return {
        id: `op:${s.name}`,
        section: 'op',
        choice: { k: 'call', spec: s },
        face: <span className="kbd fx-pick__key">{k.key}</span>,
        hint: t(`features.fn.op.${k.id}`),
      }
    }
    if (mode === 'fill') {
      if (q && NUM.test(q))
        out.push({
          id: 'num',
          section: 'value',
          choice: { k: 'num', v: Number(q.replace(',', '.')) },
          face: <ValueFace label={t('features.fn.kind.num')} value={q} />,
        })
      if (q && YES.test(q))
        out.push({
          id: 'yes',
          section: 'value',
          choice: { k: 'bool', v: true },
          face: <ValueFace value={t('features.fn.yes')} />,
        })
      if (q && NO.test(q))
        out.push({
          id: 'no',
          section: 'value',
          choice: { k: 'bool', v: false },
          face: <ValueFace value={t('features.fn.no')} />,
        })
      for (const p of params) {
        if (q && !p.name.includes(ql)) continue
        out.push({
          id: `param:${p.name}`,
          section: 'param',
          choice: { k: 'param', name: p.name },
          face: <span className="fx-pick__param">{p.name}</span>,
          hint: t(`features.fn.type.${p.type}`),
        })
      }
      if (!q) {
        out.push({
          id: 'num',
          section: 'value',
          choice: { k: 'num', v: null },
          face: <ValueFace label={t('features.fn.kind.num')} value="123" />,
        })
        out.push({
          id: 'str',
          section: 'value',
          choice: { k: 'str', v: null },
          face: <ValueFace label={t('features.fn.kind.str')} value="“abc”" />,
        })
        out.push({
          id: 'yes',
          section: 'value',
          choice: { k: 'bool', v: true },
          face: <ValueFace value={t('features.fn.yes')} />,
        })
        out.push({
          id: 'no',
          section: 'value',
          choice: { k: 'bool', v: false },
          face: <ValueFace value={t('features.fn.no')} />,
        })
      }
    }
    // operators: all keys without a query, else the ones whose key or name matches
    // operators: all keys without a query; typed as a symbol ("*", "<=") they come first …
    const opName = (s: CallSpec) => t(`features.fn.op.${OPERATOR_KEYS[s.name as keyof typeof OPERATOR_KEYS].id}`).toLowerCase()
    for (const s of catalog.operators) {
      if (!q || q === s.name || q === OPERATOR_KEYS[s.name as keyof typeof OPERATOR_KEYS].key) out.push(opOption(s))
    }
    if (!q) {
      const list = cat === 'custom' ? customs : catalog.builtins.filter((b) => b.category === cat)
      for (const s of list) out.push(fnOption(s))
    } else {
      const ranked: Array<[number, CallSpec]> = []
      for (const s of [...customs, ...catalog.builtins]) {
        const r = s.name.startsWith(qu) ? 0 : s.name.includes(qu) ? 1 : ql.length > 2 && describe(s, lang).toLowerCase().includes(ql) ? 2 : -1
        if (r >= 0) ranked.push([r, s])
      }
      ranked.sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name))
      for (const [, s] of ranked.slice(0, 60)) out.push(fnOption(s))
      // … typed as a word ("minus", "mal") after the functions (MIN before minus)
      for (const s of catalog.operators) if (ql.length > 1 && opName(s).startsWith(ql) && !out.some((o) => o.id === `op:${s.name}`)) out.push(opOption(s))
    }
    // text last: any query can be a text value
    if (mode === 'fill' && q && !NUM.test(q))
      out.push({
        id: 'str',
        section: 'value',
        choice: { k: 'str', v: q.replace(/^"(.*)"$/, '$1') },
        face: <ValueFace label={t('features.fn.kind.str')} value={`“${q.replace(/^"(.*)"$/, '$1')}”`} />,
      })
    // grouped as shown (sections in the order they first come), so ↑ ↓ follow the screen
    const first = new Map<Option['section'], number>()
    out.forEach((o, i) => first.has(o.section) || first.set(o.section, i))
    return out.map((o, i) => [o, i] as const).sort((a, b) => first.get(a[0].section)! - first.get(b[0].section)! || a[1] - b[1]).map(([o]) => o)
  }, [query, mode, params, catalog, customs, cat, lang, t])

  useEffect(() => setActive(0), [query, cat])
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(options.length - 1, a + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(0, a - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const o = options[active]
      if (o) onPick(o.choice)
    }
  }

  // sections in the order their options come (↑ ↓ walk them top to bottom); functions always show (groups)
  const LABELS: Record<Option['section'], string> = {
    value: t('features.fn.pick.values'),
    param: t('features.fn.pick.params'),
    op: t('features.fn.pick.operators'),
    fn: t('features.fn.pick.functions'),
  }
  const order: Array<Option['section']> = []
  for (const o of options) if (!order.includes(o.section)) order.push(o.section)
  if (!order.includes('fn')) order.push('fn')
  const sections = order.map((key) => ({ key, label: LABELS[key] }))
  const activeId = options[active] ? `${listId}-${active}` : undefined

  return (
    <Popover
      open
      anchor={anchor}
      onClose={onClose}
      placement="bottom-start"
      className="fx-pick"
      aria-label={mode === 'wrap' ? t('features.fn.wrapIn') : t('features.fn.pick.title')}
    >
      <div className="fx-pick__head">
        <span className="label">{mode === 'wrap' ? t('features.fn.wrapIn') : t('features.fn.pick.title')}</span>
        <input
          className="input fx-pick__search"
          value={query}
          ref={inputRef}
          data-autofocus=""
          placeholder={mode === 'wrap' ? t('features.fn.pick.searchFn') : t('features.fn.pick.search')}
          aria-label={mode === 'wrap' ? t('features.fn.pick.searchFn') : t('features.fn.pick.search')}
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={activeId}
          aria-autocomplete="list"
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKey}
        />
      </div>
      <div className="fx-pick__list" id={listId} role="listbox" ref={listRef} aria-label={t('features.fn.pick.title')}>
        {sections.map(({ key, label }) => {
          const items = options.map((o, i) => [o, i] as const).filter(([o]) => o.section === key)
          const showCats = key === 'fn' && !query.trim()
          if (!items.length && !showCats) return null
          return (
            <div key={key} className={`fx-pick__sec fx-pick__sec--${key}`} role="group" aria-label={label}>
              <div className="fx-pick__sechead label">{label}</div>
              {showCats && (
                <div className="fx-pick__cats" role="tablist" aria-label={t('features.fn.pick.categories')}>
                  {categories.map((c) => (
                    <button key={c} type="button" role="tab" aria-selected={c === cat} className="fx-pick__cat" onMouseDown={(e) => e.preventDefault()} onClick={() => setCat(c)}>
                      {t(`features.fn.cat.${c}`)}
                    </button>
                  ))}
                </div>
              )}
              <div className={key === 'op' ? 'fx-pick__keys' : key === 'param' || key === 'value' ? 'fx-pick__chips' : 'fx-pick__rows'}>
                {items.map(([o, i]) => (
                  <div
                    key={o.id}
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={i === active}
                    data-index={i}
                    data-option={o.id}
                    className={`fx-pick__opt fx-pick__opt--${o.section}`}
                    title={o.section === 'op' ? o.hint : undefined}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseMove={() => i !== active && setActive(i)}
                    onClick={() => onPick(o.choice)}
                  >
                    {o.face}
                    {o.hint && o.section !== 'op' && <span className="fx-pick__hint">{o.hint}</span>}
                  </div>
                ))}
                {showCats && !items.length && <div className="fx-pick__empty faint">{t('features.fn.pick.noneInCat')}</div>}
              </div>
            </div>
          )
        })}
        {!options.length && <div className="fx-pick__empty faint">{t('features.fn.pick.none')}</div>}
      </div>
    </Popover>
  )
}

function ValueFace({ label, value }: { label?: string; value: string }) {
  return (
    <>
      {label && <span className="fx-pick__vlabel">{label}</span>}
      <span className="fx-pick__vval">{value}</span>
    </>
  )
}
