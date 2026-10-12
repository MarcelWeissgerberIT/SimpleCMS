/**
 * The OpenRouter catalogue picker (UX § 4.4, a lazy chunk): choose a model for a role of setup step 03. A cmdk list in a
 * popover (a sheet on phones): search, filter chips (Tools · JSON · Images · PDF natively · ≤ $1 / M · only allowed
 * operators — `aria-pressed`), the ROUTER group first (the Jev Router selectable while OWNER.jevRouter; the other routers
 * dimmed "Router — blocked: forwards to models One cannot pin"), then the models (refused ones dimmed with their reason),
 * each with its capability lamps, price in / out per million, id, context and — only for rows whose endpoint list is
 * cached — "n operators". Endpoint lists are read for the visible window only (≤ 8 at a time, D-S2-34); the
 * "only allowed operators" chip narrows by cached lists only. Foot: "openrouter.ai · as of <date> · n matches".
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Command } from 'cmdk'
import { Check, Search } from 'lucide-react'
import type { CatalogRow } from '@/shared/ai/catalog'
import { JEV_ROUTER, isJevRouter } from '@/shared/ai/jev'
import { OWNER } from '@/shared/ai/owner'
import { blendedPerM } from '@/shared/ai/prices'
import { useLang, useT } from '../../../i18n'
import { useWorkspace } from '../../../store/store'
import { Popover } from '../../../ui/Popover'
import { endpointsOf, loadCatalog, type Catalog, type EndpointList } from '../core/catalog'
import { CapLamps, lampsOfRow } from './CapLamps'
import './catalog.css'

/** The endpoint lists read at once for the visible window (D-S2-34). */
export const WINDOW = 8
/** A filter narrowed to this many rows reads them all (still ≤ WINDOW at a time). */
const NARROW = 20
const LIMIT = 200

type FilterId = 'tools' | 'json' | 'images' | 'pdf' | 'price' | 'allowed'
const FILTERS: readonly FilterId[] = ['tools', 'json', 'images', 'pdf', 'price', 'allowed']

const phone = () => typeof window !== 'undefined' && window.matchMedia?.('(max-width: 600px)').matches

export interface CatalogPickerProps {
  anchor: Element | null
  /** the role being chosen ("Fast" …) — the title */
  role: string
  /** the id the role holds now (marked) */
  current?: string | null
  /** the Jev Router may be picked (≥ 2 models in the list, OWNER.jevRouter) — else its row says why */
  router: { ok: boolean; why?: string }
  onPick: (row: CatalogRow | 'router') => void
  onClose: () => void
}

export function CatalogPicker({ anchor, role, current, router, onPick, onClose }: CatalogPickerProps) {
  const t = useT()
  const lang = useLang()
  const denyRaw = useWorkspace((s) => s.ai?.policy?.providers?.openrouter?.upstream?.deny)
  const deny = useMemo(() => (denyRaw ?? []).map((d) => d.trim().toLowerCase()).filter(Boolean), [denyRaw])
  const [cat, setCat] = useState<Catalog | null | 'loading'>('loading')
  const [q, setQ] = useState('')
  const [on, setOn] = useState<ReadonlySet<FilterId>>(() => new Set())
  const [eps, setEps] = useState<Record<string, EndpointList | null>>({})
  const [active, setActive] = useState('')
  const [sheet] = useState(phone)
  const root = useRef<HTMLDivElement | null>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const asked = useRef(new Set<string>())

  useEffect(() => {
    let alive = true
    void loadCatalog().then((c) => alive && setCat(c))
    return () => {
      alive = false
    }
  }, [])
  // Esc closes the picker only (never the assistant under it)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      closeRef.current()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
  useEffect(() => {
    if (sheet) root.current?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true })
  }, [sheet])

  const rows = cat && cat !== 'loading' ? cat.rows : []
  const denied = (list: EndpointList | null | undefined) => !!list && list.endpoints.length > 0 && list.endpoints.every((e) => deny.includes(e.name.toLowerCase()) || deny.includes(e.tag.toLowerCase()) || deny.includes(e.tag.split('/')[0]!.toLowerCase()))
  const routers = rows.filter((r) => r.router || r.refused === 'router' || isJevRouter(r.id))
  const models = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return rows
      .filter((r) => !(r.router || r.refused === 'router' || isJevRouter(r.id)))
      .filter((r) => !needle || r.label.toLowerCase().includes(needle) || r.id.toLowerCase().includes(needle))
      .filter((r) => {
        const l = lampsOfRow(r)
        if (on.has('tools') && !l.tools) return false
        if (on.has('json') && !l.json) return false
        if (on.has('images') && !l.images) return false
        if (on.has('pdf') && !l.pdf) return false
        if (on.has('price') && !((blendedPerM(r.price) ?? Infinity) <= 1)) return false
        if (on.has('allowed') && denied(eps[r.id])) return false
        return true
      })
      .sort((a, b) => Number(!!a.refused) - Number(!!b.refused) || a.label.localeCompare(b.label))
      .slice(0, LIMIT)
  }, [rows, q, on, eps, deny.join('|')])

  // the visible window's endpoint lists (≤ WINDOW at a time; a narrow filter: its ≤ 20 rows, still WINDOW at a time)
  const visibleRows = useMemo(() => models.filter((r) => !r.refused).slice(0, models.length <= NARROW ? NARROW : WINDOW), [models])
  useEffect(() => {
    let alive = true
    const todo = visibleRows.map((r) => r.id).filter((id) => !asked.current.has(id))
    if (!todo.length) return
    const timer = setTimeout(async () => {
      for (let i = 0; i < todo.length; i += WINDOW) {
        const batch = todo.slice(i, i + WINDOW)
        batch.forEach((id) => asked.current.add(id))
        const lists = await Promise.all(batch.map((id) => endpointsOf(id).catch(() => null)))
        if (!alive) return
        setEps((s) => ({ ...s, ...Object.fromEntries(batch.map((id, j) => [id, lists[j] ?? null])) }))
      }
    }, 200)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [visibleRows])

  const date = cat && cat !== 'loading' ? new Date(cat.at).toLocaleString(lang === 'de' ? 'de-DE' : 'en-US', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''
  const price = (n: number) => n.toLocaleString(lang === 'de' ? 'de-DE' : 'en-US', { minimumFractionDigits: n < 0.1 ? 3 : 2, maximumFractionDigits: n < 0.1 ? 3 : 2 })
  const refusedText = (r: CatalogRow) => (r.refused ? t(`features.ai.prov.cat.refused.${r.refused}`) : denied(eps[r.id]) ? t('features.ai.prov.cat.blocked') : '')

  const routerRow = (r: CatalogRow) => {
    const jev = isJevRouter(r.id) && OWNER.jevRouter
    const ok = jev && router.ok
    return (
      <Command.Item key={r.id} value={r.id} disabled={!ok} className="cat-row" data-row={r.id} data-off={!ok || undefined} onSelect={() => ok && onPick('router')}>
        <span className="cat-row__name">
          <span>{jev ? 'Jev Router' : r.label}</span>
        </span>
        <span className="cat-row__price">{jev ? t('features.ai.jev.router.price') : ''}</span>
        <span className="cat-row__line">{jev ? (ok ? t('features.ai.jev.router.lead') : (router.why ?? t('features.ai.jev.router.needs2'))) : t('features.ai.prov.cat.routerLocked')}</span>
      </Command.Item>
    )
  }

  const body = (
    <div ref={root} className="aicat" data-sheet={sheet ? '' : undefined} data-testid="catalog-picker">
      <p className="aicat__title label">{t('features.ai.prov.cat.title', { role })}</p>
      <Command label={t('features.ai.prov.cat.title', { role })} shouldFilter={false} value={active} onValueChange={setActive} loop className="aicat__cmd">
        <div className="aicat__search">
          <Search size={14} aria-hidden />
          <Command.Input className="aicat__input" value={q} onValueChange={setQ} placeholder={t('features.ai.prov.cat.search')} data-autofocus="" />
        </div>
        <div className="aicat__filters" role="group" aria-label={t('features.ai.prov.cat.filters')}>
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              className="fchip"
              aria-pressed={on.has(f)}
              data-filter={f}
              onClick={() =>
                setOn((s) => {
                  const n = new Set(s)
                  if (n.has(f)) n.delete(f)
                  else n.add(f)
                  return n
                })
              }
            >
              {on.has(f) && <Check size={11} aria-hidden />} {t(`features.ai.prov.cat.filter.${f}`)}
            </button>
          ))}
        </div>
        <Command.List className="aicat__list">
          {cat === 'loading' && <Command.Loading>{t('features.ai.prov.cat.loading')}</Command.Loading>}
          {cat === null && <div className="aicat__empty">{t('features.ai.prov.cat.failed')}</div>}
          {cat && cat !== 'loading' && (
            <>
              {routers.length > 0 && !q.trim() && <Command.Group heading={t('features.ai.prov.cat.group.router')}>{[...routers].sort((a, b) => Number(!isJevRouter(a.id)) - Number(!isJevRouter(b.id))).map(routerRow)}</Command.Group>}
              <Command.Group heading={t('features.ai.prov.cat.group.models')}>
                {models.map((r) => {
                  const why = refusedText(r)
                  const list = eps[r.id]
                  return (
                    <Command.Item key={r.id} value={r.id} disabled={!!why} className="cat-row" data-row={r.id} data-off={why ? '' : undefined} data-current={r.id === current || undefined} onSelect={() => !why && onPick(r)}>
                      <span className="cat-row__name">
                        <span>{r.label}</span>
                        <CapLamps lamps={lampsOfRow(r)} />
                      </span>
                      <span className="cat-row__price">
                        {r.price ? `${price(r.price.input)} / ${price(r.price.output)} $` : '—'}
                        <small>{t('features.ai.prov.price.unit')}</small>
                      </span>
                      <span className="cat-row__line">
                        <span>{r.id}</span>
                        <span>{t('features.ai.prov.cat.context', { n: r.context >= 1_000_000 ? `${Math.round(r.context / 100_000) / 10} M` : `${Math.round(r.context / 1000)} k` })}</span>
                        {list && list.endpoints.length > 0 && <span data-testid="cat-operators">{t('features.ai.prov.cat.operators', { n: list.endpoints.length })}</span>}
                        {why && <span className="cat-row__why">{why}</span>}
                      </span>
                    </Command.Item>
                  )
                })}
              </Command.Group>
              {!models.length && <Command.Empty className="aicat__empty">{t('features.ai.prov.cat.empty')}</Command.Empty>}
            </>
          )}
        </Command.List>
      </Command>
      <div className="aicat__foot">
        <span className="label">{cat && cat !== 'loading' ? t('features.ai.prov.cat.foot', { date, n: models.length }) : ''}</span>
        <span className="label aicat__keys">{t('features.ai.prov.cat.keys')}</span>
      </div>
    </div>
  )

  if (sheet)
    return createPortal(
      <div className="route-sheet" data-popover="">
        <button type="button" className="route-sheet__scrim" aria-label={t('common.close')} tabIndex={-1} onClick={onClose} />
        <div className="route-sheet__panel cat-sheet" role="dialog" aria-modal="true" aria-label={t('features.ai.prov.cat.title', { role })}>
          {body}
        </div>
      </div>,
      document.body,
    )
  return (
    <Popover open anchor={anchor} onClose={onClose} placement="bottom-end" offset={6} className="cat-pop" role="dialog" aria-label={t('features.ai.prov.cat.title', { role })}>
      {body}
    </Popover>
  )
}

/** The router's id (Models.tsx writes it into a role). */
export { JEV_ROUTER }
