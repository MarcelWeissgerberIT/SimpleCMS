/**
 * Step 03 — models (UX § 4.4). Per provider (tabs) three roles: Fast · Standard · Deep, each with its model, capability
 * lamps, price in / out per million and "≈ per short answer"; Change opens Claude's models inline, OpenRouter's catalogue
 * picker (lazy). OpenRouter starts with suggestions (catalogue data, D-S2-34: the ≤ 3 picks' endpoint lists are checked
 * against the operator rule and a refused pick is skipped) — a role without one reads "— none via OpenRouter —" and which
 * Claude model One takes for it (display only). A fourth line: the Jev Router over the list (≥ 2 models), with its stated
 * bound and that Jev (TypeSafe) reads to choose; every role may pick it (the tier comes from the role). The Checker row
 * shows "Soon" (the decisions slice). Next writes the shortlist rows (never the router) and the roles in ONE update.
 */
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Network } from 'lucide-react'
import type { ProviderId, ShortlistRow } from '@/shared/ai/types'
import { capsOfRow, suggestRoles, type CatalogRow } from '@/shared/ai/catalog'
import { JEV_ROUTER, isJevRouter, JEV_TIERS } from '@/shared/ai/jev'
import { OWNER } from '@/shared/ai/owner'
import { MAX_SHORTLIST } from '@/shared/ai/policy'
import { MODELS } from '@/shared/ai/models'
import { providerInfo } from '@/shared/ai/providers'
import { useWorkspace } from '../../../../store/store'
import { setDeviceAI } from '../../../../store/aiRules'
import { withWriter } from '../../../../store/writer'
import { useLang, useT } from '../../../../i18n'
import { fmtCost } from '../../../../lib/money'
import { CapLamps, lampsOfCaps } from '../../routing/CapLamps'
import { claudeRoles, hasKeyIn, NO_ROWS, perM, ROLE_KEYS, routerBound, shortAnswerUsd, type RoleKey } from '../facts'
import { CodePlate } from '../ProviderPlate'
import { Rich } from '../AINeedsSetup'
import type { StepProps } from '../AISetup'

const CatalogPicker = lazy(() => import('../../routing/CatalogPicker').then((m) => ({ default: m.CatalogPicker })))

type Draft = Partial<Record<RoleKey, string>>

/** A catalogue row as a shortlist row (price + caps + the day it was read; never the router). */
export const shortRow = (r: CatalogRow): ShortlistRow => ({ m: r.id, label: r.label, price: r.price, caps: capsOfRow(r), at: new Date().toISOString().slice(0, 10) })

export function ModelsStep({ run, setRun, handle }: StepProps) {
  const t = useT()
  const lang = useLang()
  const settings = useWorkspace((s) => s.settings)
  const tabs = (['anthropic', 'openrouter'] as const).filter((p) => hasKeyIn(settings, p) && !run.skipped.includes(p))
  const active: ProviderId = run.tab && (tabs as readonly string[]).includes(run.tab) ? run.tab : (tabs[tabs.length - 1] ?? 'anthropic')
  const [claude, setClaude] = useState<Draft>(() => ({ ...claudeRoles(), ...(settings.ai?.roles?.anthropic ?? {}) }))
  const [claudeTouched, setClaudeTouched] = useState(false)
  const [or, setOr] = useState<Draft>(() => ({ ...(settings.ai?.roles?.openrouter ?? {}) }))
  const [suggested, setSuggested] = useState<ReadonlySet<RoleKey>>(() => new Set())
  const [rows, setRows] = useState<Record<string, CatalogRow>>({})
  const [loading, setLoading] = useState(false)
  const [choosing, setChoosing] = useState<RoleKey | null>(null)
  const anchors = useRef(new Map<RoleKey, HTMLButtonElement>())

  // OpenRouter: the catalogue (read once a day at most) and suggestions for empty roles
  useEffect(() => {
    if (!tabs.includes('openrouter' as never)) return
    let alive = true
    setLoading(true)
    void (async () => {
      const { loadCatalog, pinsFor } = await import('../../core/catalog')
      const cat = await loadCatalog()
      if (!alive) return
      setLoading(false)
      if (!cat) return
      const byId = Object.fromEntries(cat.rows.map((r) => [r.id, r]))
      setRows(byId)
      const have = settings.ai?.roles?.openrouter ?? {}
      if (ROLE_KEYS.every((k) => have[k])) return
      const deny = useWorkspace.getState().ai?.policy?.providers?.openrouter?.upstream?.deny ?? []
      const refused = new Set<string>()
      // up to three rounds: a suggestion no allowed operator serves is skipped and the next one taken
      for (let round = 0; round < 3; round++) {
        const s = suggestRoles(cat.rows, (r) => !refused.has(r.id))
        const picks = ROLE_KEYS.filter((k) => !have[k]).map((k) => [k, s[k]] as const)
        const checks = await Promise.all(picks.map(([, id]) => (id ? pinsFor(id, { deny }) : Promise.resolve(null))))
        if (!alive) return
        const bad = picks.filter(([, id], i) => id && !checks[i])
        bad.forEach(([, id]) => refused.add(id!))
        if (!bad.length || round === 2) {
          const draft: Draft = {}
          picks.forEach(([k, id], i) => {
            if (id && checks[i]) draft[k] = id
          })
          setOr((d) => ({ ...draft, ...d }))
          setSuggested(new Set(Object.keys(draft) as RoleKey[]))
          return
        }
      }
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const list = settings.ai?.models ?? NO_ROWS
  /** the shortlist after this step (the existing rows + the roles' models — never the router) */
  const nextList = useMemo(() => {
    const out = [...list]
    for (const k of ROLE_KEYS) {
      const id = or[k]
      if (!id || isJevRouter(id) || out.some((r) => r.m === id)) continue
      const row = rows[id]
      if (row) out.push(shortRow(row))
    }
    return out.slice(-MAX_SHORTLIST)
  }, [list, or, rows])
  const routerOk = OWNER.jevRouter && nextList.length >= 2

  useEffect(() => {
    handle({
      canNext: tabs.length > 0,
      commit: () => {
        const roles = { ...(useWorkspace.getState().settings.ai?.roles ?? {}) }
        if (tabs.includes('openrouter' as never)) {
          const clean: Draft = {}
          for (const k of ROLE_KEYS) if (or[k] && (!isJevRouter(or[k]) || routerOk)) clean[k] = or[k]
          if (Object.keys(clean).length) roles.openrouter = clean
        }
        if (claudeTouched) roles.anthropic = claude
        withWriter({ kind: 'you', via: 'setup' }, () => setDeviceAI({ models: nextList.length ? nextList : undefined, roles: Object.keys(roles).length ? roles : undefined }))
        return true
      },
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs.join(), or, claude, claudeTouched, nextList, routerOk, handle])

  const pickOr = (role: RoleKey, row: CatalogRow | 'router') => {
    setOr((d) => ({ ...d, [role]: row === 'router' ? JEV_ROUTER : row.id }))
    if (row !== 'router') setRows((r) => ({ ...r, [row.id]: row }))
    setSuggested((s) => {
      const n = new Set(s)
      n.delete(role)
      return n
    })
    setChoosing(null)
    requestAnimationFrame(() => anchors.current.get(role)?.focus())
  }

  const bound = routerBound(nextList)
  const tier = (role: RoleKey) => t(`features.ai.jev.router.tier.${JEV_TIERS[ROLE_KEYS.indexOf(role)] ?? 'medium'}`)
  const claudeOf = (role: RoleKey) => MODELS.find((m) => m.route.p === 'anthropic' && m.route.m === claude[role])

  return (
    <div className="aim">
      <div className="ptabs" role="tablist" aria-label={t('features.ai.prov.key.tabs')}>
        {tabs.map((p) => {
          const n = ROLE_KEYS.filter((k) => (p === 'anthropic' ? claude[k] : or[k])).length
          return (
            <button key={p} type="button" role="tab" className="ptab" aria-selected={p === active} tabIndex={p === active ? 0 : -1} onClick={() => setRun({ tab: p })} data-testid={`models-tab-${p}`}>
              <CodePlate p={p} />
              <span className="ptab__name">{providerInfo(p).name}</span>
              <span className="label">{t('features.ai.prov.role.tabCount', { n })}</span>
            </button>
          )
        })}
      </div>
      <div className="aim-grid">
        <div className="aim-roles" role="tabpanel" aria-label={providerInfo(active).name}>
          {ROLE_KEYS.map((role) => {
            if (active === 'anthropic') {
              const m = claudeOf(role)
              const usd = m ? shortAnswerUsd(m.route, m.price) : null
              return (
                <ClaudeRole
                  key={role}
                  role={role}
                  label={m?.label ?? '—'}
                  lamps={lampsOfCaps(m?.caps)}
                  price={m?.price ? t('features.ai.prov.price.inOut', { in: perM(m.price.input, lang, false), out: perM(m.price.output, lang, false) }) : '—'}
                  per={usd !== null ? t('features.ai.prov.role.perAnswer', { usd: fmtCost(usd, lang) }) : ''}
                  value={claude[role] ?? ''}
                  onChange={(id) => {
                    setClaude((c) => ({ ...c, [role]: id }))
                    setClaudeTouched(true)
                  }}
                />
              )
            }
            const id = or[role]
            const jev = !!id && isJevRouter(id)
            const row = id && !jev ? (rows[id] ?? null) : null
            const short = id && !jev ? list.find((r) => r.m === id) : undefined
            const label = jev ? t('features.ai.prov.jev.role', { tier: tier(role) }) : (row?.label ?? short?.label ?? id ?? '')
            const price = row?.price ?? short?.price ?? (jev ? bound : null)
            const caps = row ? capsOfRow(row) : short?.caps
            const usd = id && price ? shortAnswerUsd({ p: 'openrouter', m: id }, price) : null
            const fallback = claudeOf(role)
            return (
              <div key={role} className="aim-role" data-active={choosing === role || undefined} data-none={!id || undefined} data-testid={`role-${role}`}>
                <span className="aim-role__k">
                  <span className="label">{t(`features.ai.prov.role.${role}`)}</span>
                  <small>{t(`features.ai.prov.role.${role}Sub`)}</small>
                </span>
                <span className="aim-role__pick">
                  {id ? <b>{label}</b> : <b className="aim-role__none">{loading ? t('features.ai.prov.role.suggesting') : t('features.ai.prov.role.none', { p: providerInfo('openrouter').name })}</b>}
                  {suggested.has(role) && <span className="tag aim-role__tag">{t('features.ai.prov.role.suggested')}</span>}
                </span>
                <span className="aim-role__meta">
                  {id && !jev && <CapLamps lamps={lampsOfCaps(caps)} />}
                  {id && price && <span>{jev ? t('features.ai.jev.router.bound', { in: perM(price.input, lang, false), out: perM(price.output, lang, false) }) : t('features.ai.prov.price.inOut', { in: perM(price.input, lang, false), out: perM(price.output, lang, false) })}</span>}
                  {!id && !loading && fallback && <span>{t('features.ai.prov.role.noneFallback', { m: fallback.label, price: fallback.price ? t('features.ai.prov.price.inOut', { in: perM(fallback.price.input, lang, false), out: perM(fallback.price.output, lang, false) }) : '—' })}</span>}
                </span>
                {id && usd !== null && <span className="aim-role__eg">{t('features.ai.prov.role.perAnswer', { usd: (jev ? '≤ ' : '') + fmtCost(usd, lang) })}</span>}
                <button
                  type="button"
                  className="btn btn--sm aim-role__btn"
                  ref={(el) => {
                    if (el) anchors.current.set(role, el)
                  }}
                  aria-expanded={choosing === role}
                  aria-haspopup="dialog"
                  onClick={() => setChoosing((c) => (c === role ? null : role))}
                  data-testid={`role-${role}-change`}
                >
                  {id ? t('features.ai.prov.role.change') : t('features.ai.prov.role.choose')}
                </button>
              </div>
            )
          })}
          {active === 'openrouter' && OWNER.jevRouter && (
            <div className="aim-role aim-role--jev" data-testid="jev-line" data-ok={routerOk || undefined}>
              <Network size={15} strokeWidth={1.7} aria-hidden className="aim-role__icon" />
              <p className="aim-role__jev">
                {routerOk ? t('features.ai.prov.jev.line', { n: nextList.length, in: perM(bound.input, lang, false), out: perM(bound.output, lang, false) }) : `Jev Router — ${t('features.ai.jev.router.needs2')}`}
                {routerOk && <span className="aim-role__reads">{t('features.ai.prov.jev.reads')}</span>}
              </p>
            </div>
          )}
          {active === 'openrouter' && (
            <div className="aim-role aim-role--exp" data-testid="role-checker" aria-disabled="true">
              <span className="aim-role__k">
                <span className="label">{t('features.ai.prov.role.checker')}</span>
                <small>{t('features.ai.prov.role.checkerSub')}</small>
              </span>
              <span className="aim-role__pick">
                <b>Jev</b>
                <span className="lampcap" data-tone="amber">
                  {t('features.ai.prov.role.checkerSoon')}
                </span>
              </span>
              <span className="aim-role__meta">{t('features.ai.prov.role.checkerNote')}</span>
            </div>
          )}
          <p className="aim-plain">
            <Rich text={t('features.ai.prov.role.plain')} />
          </p>
          {active === 'openrouter' && <p className="label aim-list">{t('features.ai.prov.role.list', { n: nextList.length })}</p>}
        </div>
      </div>
      {choosing && active === 'openrouter' && (
        <Suspense fallback={null}>
          <CatalogPicker
            anchor={anchors.current.get(choosing) ?? null}
            role={t(`features.ai.prov.role.${choosing}`)}
            current={or[choosing] ?? null}
            router={{ ok: routerOk, why: t('features.ai.jev.router.needs2') }}
            onPick={(row) => pickOr(choosing, row)}
            onClose={() => {
              const r = choosing
              setChoosing(null)
              requestAnimationFrame(() => anchors.current.get(r)?.focus())
            }}
          />
        </Suspense>
      )}
    </div>
  )
}

/** A Claude role: its model and an inline choice of Claude's models. */
function ClaudeRole({ role, label, lamps, price, per, value, onChange }: { role: RoleKey; label: string; lamps: ReturnType<typeof lampsOfCaps>; price: string; per: string; value: string; onChange: (id: string) => void }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const choices = MODELS.filter((m) => m.route.p === 'anthropic' && m.selectable)
  return (
    <div className="aim-role" data-active={open || undefined} data-testid={`role-${role}`}>
      <span className="aim-role__k">
        <span className="label">{t(`features.ai.prov.role.${role}`)}</span>
        <small>{t(`features.ai.prov.role.${role}Sub`)}</small>
      </span>
      <span className="aim-role__pick">
        <b>{label}</b>
      </span>
      <span className="aim-role__meta">
        <CapLamps lamps={lamps} />
        <span>{price}</span>
      </span>
      {per && <span className="aim-role__eg">{per}</span>}
      <button type="button" className="btn btn--sm aim-role__btn" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid={`role-${role}-change`}>
        {t('features.ai.prov.role.change')}
      </button>
      {open && (
        <div className="aim-role__choices" role="radiogroup" aria-label={t(`features.ai.prov.role.${role}`)}>
          {choices.map((m) => (
            <button
              key={m.route.m}
              type="button"
              role="radio"
              aria-checked={m.route.m === value}
              className="aim-role__choice"
              onClick={() => {
                onChange(m.route.m)
                setOpen(false)
              }}
            >
              {m.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
