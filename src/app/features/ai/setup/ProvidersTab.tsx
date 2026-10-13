/**
 * Settings › AI (this device, UX § 5.7): "Set up AI …"; compact provider plates (state, key marker, the free check —
 * no text sent —, Change key, Remove … with its impact list; OpenRouter: its key's limit from /key, "Set a limit ↗",
 * Disconnect + "Delete the key 'One' at OpenRouter ↗", and the Jev Router line); "This device" — a row per kind of work
 * (Questions = ask + workspace; MCP tests & media = mcp-setup + generate) with "Like the workspace" or a model, plus the
 * device default; Data — the workspace's rule per provider in one line + Change (step 04); Your own data; Usage on this
 * device (today / 30 days per provider, read in idle, never at boot); the MCP servers and the memory switches.
 * Replaces the old single key field, model select, token-spending "Test key" and privacy note.
 */
import { useEffect, useRef, useState } from 'react'
import { ArrowRight } from 'lucide-react'
import type { FeatureClass, MemberClass, ProviderId, RouteRule } from '@/shared/ai/types'
import { presetOf } from '@/shared/ai/policy'
import { MODELS } from '@/shared/ai/models'
import { PROVIDER_ORDER, PROVIDERS, providerInfo } from '@/shared/ai/providers'
import { JEV_ROUTER, JEV_TIERS } from '@/shared/ai/jev'
import { OWNER } from '@/shared/ai/owner'
import { routeKey } from '@/shared/ai/route'
import { useWorkspace } from '../../../store/store'
import { useUI } from '../../../store/ui'
import { setDeviceAI, setDeviceDefault, setDeviceRule } from '../../../store/aiRules'
import { keyLimitUrl } from '../../../store/secrets'
import { useLang, useT } from '../../../i18n'
import { fmtUsd } from '../../../lib/money'
import { HelpLink } from '../../../help'
import { verifyProvider } from '../core/verify'
import { routable } from '../core/routable'
import { labelFor } from '../core/registry'
import { McpServers } from '../mcp-servers/McpServers'
import { MemorySettings } from '../memory'
import { ledgerTotals, type LedgerTotal } from '../../governor'
import { DeviceBrake } from '../../governor/ui/DeviceBrake'
import { hasKeyIn, NO_ROWS, PLATE_ORDER, plateState, receivesNothing, setCheck, useChecks } from './facts'
import { ProviderPlate } from './ProviderPlate'
import { RemovePanel, dropKey } from './remove'
import { MemberData } from './MemberData'
import { openAISetup } from './openAISetup'
import { helpFor } from './errors'
import { Rich } from './AINeedsSetup'
import { GateSetting } from '../decide/ui/GateRow'
import { isJevModel } from '@/shared/ai/jev'
import './plates.css'
import './settings.css'

/** The free check from Settings (no text sent). */
async function check(p: ProviderId) {
  setCheck(p, { state: 'checking', at: Date.now() })
  const r = await verifyProvider(p).catch(() => ({ ok: false as const, code: 'offline' as const }))
  setCheck(p, r.ok ? { state: 'valid', ...(r.credit ? { credit: r.credit } : {}), at: Date.now() } : { state: 'error', code: r.code, at: Date.now() })
}

/** The rows of "This device": one per kind of work as people see them. */
const ROWS: Array<{ id: string; classes: FeatureClass[] }> = [
  { id: 'write', classes: ['write'] },
  { id: 'ask', classes: ['ask', 'workspace'] },
  { id: 'structure', classes: ['structure'] },
  { id: 'vision', classes: ['vision'] },
  { id: 'documents', classes: ['documents'] },
  { id: 'bulk', classes: ['bulk'] },
  { id: 'meeting', classes: ['meeting'] },
  { id: 'memory', classes: ['memory'] },
  { id: 'outbox', classes: ['outbox'] },
  { id: 'terminal', classes: ['terminal'] },
  { id: 'agents', classes: ['agents'] },
  { id: 'scripts', classes: ['scripts'] },
  { id: 'help', classes: ['help'] },
  { id: 'mcp', classes: ['mcp-setup', 'generate'] },
]
// 'review' is a slice of its own (S6); 'gate' (slice SJ) has its own row below: Jev versions only, starts off

export function ProvidersTab({ section }: { section?: 'mcp' | 'memory' | 'limit' }) {
  const t = useT()
  const mcpRef = useRef<HTMLDivElement>(null)
  const memRef = useRef<HTMLDivElement>(null)
  const limitRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = section === 'mcp' ? mcpRef.current : section === 'memory' ? memRef.current : section === 'limit' ? limitRef.current : null
    if (!el) return
    // a frame after the dialog focused its tab: the section takes the focus (and the view) from there
    let id = requestAnimationFrame(() => {
      id = requestAnimationFrame(() => {
        el.scrollIntoView({ block: 'start' })
        el.focus({ preventScroll: true })
      })
    })
    return () => cancelAnimationFrame(id)
  }, [section])
  return (
    <div className="aip" data-testid="ai-settings">
      <h3 className="st-h">
        {t('shell.settings.ai.title')} <HelpLink id="ai-providers" />
      </h3>
      <p className="st-p">{t('features.ai.prov.tab.lead')}</p>
      <div className="aip__keys">
        <button type="button" className="btn btn--ink" onClick={() => openAISetup({ reason: 'add' })} data-testid="ai-setup-open">
          {t('features.ai.prov.tab.setup')}
        </button>
      </div>
      <Plates />
      <DeviceRows />
      <DataLines />
      <OwnData />
      <Usage />
      <div ref={limitRef} data-section="limit" tabIndex={-1} aria-label={t('features.governor.device.title')}>
        <DeviceBrake />
      </div>
      <div ref={mcpRef} className="aip__section" data-section="mcp" tabIndex={-1} aria-label={t('features.ai.prov.tab.mcp')}>
        <McpProviders />
        <McpServers />
      </div>
      <div ref={memRef} className="aip__section" data-section="memory" tabIndex={-1} aria-label={t('features.ai.prov.tab.memory')}>
        <MemorySettings />
      </div>
    </div>
  )
}

function Plates() {
  const t = useT()
  const lang = useLang()
  const settings = useWorkspace((s) => s.settings)
  const wsAI = useWorkspace((s) => s.ai)
  const checks = useChecks()
  const [removing, setRemoving] = useState<ProviderId | null>(null)
  const [orLimit, setOrLimit] = useState<string>(PROVIDERS.openrouter.limitUrl)
  const orKey = hasKeyIn(settings, 'openrouter')
  useEffect(() => {
    let alive = true
    if (orKey) void keyLimitUrl('openrouter').then((u) => alive && u && setOrLimit(u))
    return () => {
      alive = false
    }
  }, [orKey])
  const list = settings.ai?.models ?? NO_ROWS
  return (
    <section className="aip__plates" aria-label={t('features.ai.prov.tab.providers')}>
      {PLATE_ORDER.map((p) => {
        const has = hasKeyIn(settings, p)
        const c = checks[p]
        const state = plateState(p, { hasKey: has, picked: false, check: c, empty: receivesNothing(p, wsAI, settings.ai) })
        const info = providerInfo(p)
        const credit = c?.credit
        return (
          <ProviderPlate
            key={p}
            p={p}
            state={state}
            compact
            testId={`settings-plate-${p}`}
            keys={
              removing === p ? (
                <RemovePanel
                  p={p}
                  onCancel={() => setRemoving(null)}
                  onDone={(msg, undo) => {
                    setRemoving(null)
                    useUI.getState().toast({ message: msg, kind: 'info', ...(undo ? { action: { label: t('features.ai.prov.remove.undo'), run: undo } } : {}) })
                  }}
                />
              ) : state === 'soon' ? undefined : has ? (
                <>
                  <button type="button" className="btn btn--sm" onClick={() => void check(p)} disabled={c?.state === 'checking'} data-testid={`settings-check-${p}`}>
                    {c?.state === 'checking' ? t('features.ai.prov.check.checking') : t('features.ai.prov.tab.check')}
                  </button>
                  <button type="button" className="btn btn--sm" onClick={() => openAISetup({ reason: 'rotate', step: 'key', provider: p })} data-testid={`settings-change-${p}`}>
                    {t('features.ai.prov.plate.change')}
                  </button>
                  {p === 'openrouter' ? (
                    <button
                      type="button"
                      className="btn btn--sm btn--ghost"
                      onClick={() => {
                        dropKey('openrouter')
                        useUI.getState().toast({ message: t('features.ai.prov.disconnected'), kind: 'info' })
                      }}
                      data-testid="settings-disconnect"
                    >
                      {t('features.ai.prov.key.disconnect')}
                    </button>
                  ) : null}
                  <button type="button" className="btn btn--sm btn--ghost" onClick={() => setRemoving(p)} data-testid={`settings-remove-${p}`}>
                    {t('features.ai.prov.plate.remove')}
                  </button>
                </>
              ) : (
                <button type="button" className="btn btn--sm btn--ink" onClick={() => openAISetup({ reason: 'add', step: 'key', provider: p })} data-testid={`settings-setup-${p}`}>
                  {t('features.ai.prov.pick', { p: info.name })}
                </button>
              )
            }
            footNote={state === 'soon' ? t('features.ai.prov.plate.soon') : undefined}
          >
            {c?.state === 'valid' && <p className="pplate__extra" data-testid={`settings-checked-${p}`}>{t('features.ai.prov.check.listed', { time: new Date(c.at).toLocaleTimeString(lang === 'de' ? 'de-DE' : 'en-US', { hour: '2-digit', minute: '2-digit' }) })}</p>}
            {c?.state === 'error' &&
              (p === 'openrouter' && c.code === 'no_credit' ? (
                // a valid key without credit (402) — kept, as step 02 says it
                <p className="pplate__extra" role="status" data-testid={`settings-err-${p}`} data-code={c.code}>
                  {t('features.ai.prov.err.noCreditKept')}{' '}
                  <a className="aik-link" href={PROVIDERS.openrouter.creditsUrl} target="_blank" rel="noreferrer noopener">
                    {t('features.ai.prov.err.topUp')}
                  </a>
                </p>
              ) : (
                // the step's own help sentence (never the bare code)
                <p className="pplate__extra" role="alert" data-testid={`settings-err-${p}`} data-code={c.code}>
                  <Rich text={helpFor(c.code ?? 'unknown', p).text} />{' '}
                  <button type="button" className="btn btn--sm btn--ghost" onClick={() => openAISetup({ reason: 'refused', step: 'key', provider: p })} data-testid={`settings-err-fix-${p}`}>
                    {t('features.ai.prov.fix.key')}
                  </button>
                </p>
              ))}
            {p === 'openrouter' && has && credit && (
              <p className="pplate__extra" data-testid="settings-or-limit">
                {credit.limit !== null ? t('features.ai.prov.lim.live', { used: fmtUsd(credit.used, lang), limit: fmtUsd(credit.limit, lang) }) : t('features.ai.prov.lim.liveNone', { used: fmtUsd(credit.used, lang) })}{' '}
                <a className="aik-link" href={orLimit} target="_blank" rel="noreferrer noopener">
                  {t('features.ai.prov.key.limitLink')}
                </a>
              </p>
            )}
            {p === 'openrouter' && has && (
              <p className="pplate__extra">
                <a className="aik-link" href={PROVIDERS.openrouter.keyUrl} target="_blank" rel="noreferrer noopener">
                  {t('features.ai.prov.tab.deleteAtOR')}
                </a>
              </p>
            )}
            {p === 'openrouter' && has && OWNER.jevRouter && (
              <p className="pplate__extra" data-testid="settings-jev">
                {list.length >= 2 ? t('features.ai.prov.tab.jev', { n: list.length }) : t('features.ai.prov.tab.jevNeeds')}
              </p>
            )}
          </ProviderPlate>
        )
      })}
    </section>
  )
}

/** The routes a device row may pick: Claude's models (a key here), the OpenRouter list and the Jev Router (a key here). */
function routeOptions(t: ReturnType<typeof useT>, classes: FeatureClass[]): Array<{ value: string; label: string; rule: RouteRule }> {
  const s = useWorkspace.getState().settings
  const out: Array<{ value: string; label: string; rule: RouteRule }> = []
  if (hasKeyIn(s, 'anthropic')) for (const m of MODELS) if (m.route.p === 'anthropic' && m.selectable) out.push({ value: routeKey(m.route), label: m.label, rule: [{ p: 'anthropic', m: m.route.m }] })
  if (hasKeyIn(s, 'openrouter') && classes.every((c) => routable('openrouter', c))) {
    const list = s.ai?.models ?? []
    for (const r of list) out.push({ value: `openrouter:${r.m}`, label: labelFor({ p: 'openrouter', m: r.m }), rule: [{ p: 'openrouter', m: r.m }] })
    if (OWNER.jevRouter && list.length >= 2)
      for (const tier of JEV_TIERS) out.push({ value: `openrouter:${JEV_ROUTER}#${tier}`, label: t('features.ai.jev.router.row', { tier: t(`features.ai.jev.router.tier.${tier}`) }), rule: [{ p: 'openrouter', m: JEV_ROUTER, effort: tier }] })
  }
  return out
}

const valueOf = (rule: RouteRule | undefined | null): string => (rule?.[0] ? `${routeKey(rule[0])}${rule[0].effort ? `#${rule[0].effort}` : ''}` : '')

function DeviceRows() {
  const t = useT()
  const device = useWorkspace((s) => s.settings.ai)
  // the options follow the keys and the list of this device
  useWorkspace((s) => [s.settings.aiApiKey, s.settings.aiKeys?.openrouter ?? '', s.settings.ai?.models?.length ?? 0].join('|'))
  const orKey = useWorkspace((s) => hasKeyIn(s.settings, 'openrouter'))
  const def = routeOptions(t, ['write'])
  const set = (classes: FeatureClass[], v: string, opts: Array<{ value: string; rule: RouteRule }>) => {
    const rule = v ? (opts.find((o) => o.value === v)?.rule ?? null) : null
    for (const c of classes) setDeviceRule(c, rule)
  }
  return (
    <section className="aip__device" aria-labelledby="aip-device" data-testid="settings-device">
      <h4 className="aip__h" id="aip-device">
        {t('features.ai.prov.tab.device')} <span className="label">{t('features.ai.prov.tab.deviceSub')}</span>
      </h4>
      <div className="aip__rows">
        <label className="aip__row aip__row--default">
          <span className="aip__work">{t('features.ai.prov.tab.default')}</span>
          <select className="input aip__select" value={valueOf(device?.default)} onChange={(e) => setDeviceDefault(e.target.value ? (def.find((o) => o.value === e.target.value)?.rule ?? null) : null)} data-testid="device-default">
            <option value="">{t('features.ai.prov.tab.like')}</option>
            {def.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <GateSetting
          ready={orKey}
          value={device?.routes?.gate?.[0]?.p === 'openrouter' && isJevModel(device.routes.gate[0].m) ? device.routes.gate[0].m : null}
          onChange={(id) => setDeviceRule('gate', id ? [{ p: 'openrouter', m: id }] : null)}
          verify={device?.jev?.verify === true}
          onVerify={(on) => setDeviceAI({ jev: { ...(useWorkspace.getState().settings.ai?.jev ?? {}), verify: on } })}
        />
        {ROWS.map((row) => {
          const opts = routeOptions(t, row.classes)
          const later = orKey && !row.classes.every((c) => routable('openrouter', c))
          const label = row.id === 'ask' ? t('features.ai.prov.tab.ask') : row.id === 'mcp' ? t('features.ai.prov.tab.mcpRow') : t(`features.ai.prov.class.${row.id}`)
          return (
            <label key={row.id} className="aip__row" data-row={row.id}>
              <span className="aip__work">
                {label}
                {later && <span className="label aip__later">OR · {t('features.ai.prov.tab.later')}</span>}
              </span>
              <select className="input aip__select" value={valueOf(device?.routes?.[row.classes[0]!])} onChange={(e) => set(row.classes, e.target.value, opts)} data-testid={`device-row-${row.id}`}>
                <option value="">{t('features.ai.prov.tab.like')}</option>
                {opts.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          )
        })}
      </div>
    </section>
  )
}

function DataLines() {
  const t = useT()
  const ws = useWorkspace((s) => s.ai)
  const settings = useWorkspace((s) => s.settings)
  const shown = PROVIDER_ORDER.filter((p) => providerInfo(p).shipped && hasKeyIn(settings, p))
  if (!shown.length) return null
  return (
    <section className="aip__data" aria-labelledby="aip-data" data-testid="settings-data">
      <h4 className="aip__h" id="aip-data">
        {t('features.ai.prov.tab.data')} <HelpLink id="ai-data-rules" />
      </h4>
      {shown.map((p) => {
        const rule = ws?.policy?.providers?.[p]
        const id = rule ? presetOf(rule.allow) : p === 'anthropic' ? 'claude' : 'none'
        const preset = id === 'claude' ? t('features.ai.prov.preset.allClaude') : id === 'none' ? t('features.ai.prov.done.nothing') : t(`features.ai.prov.preset.${id}`)
        return (
          <p key={p} className="aip__dline" data-provider={p}>
            <b>{providerInfo(p).name}</b>
            <span>{t('features.ai.prov.tab.dataLine', { preset })}</span>
            <button type="button" className="btn btn--sm btn--ghost" onClick={() => openAISetup({ reason: 'change', step: 'data', provider: p })} data-testid={`settings-data-${p}`}>
              {t('features.ai.prov.tab.dataChange')} <ArrowRight size={12} aria-hidden />
            </button>
          </p>
        )
      })}
    </section>
  )
}

function OwnData() {
  const settings = useWorkspace((s) => s.settings)
  const shown = PROVIDER_ORDER.filter((p) => providerInfo(p).shipped && hasKeyIn(settings, p))
  return (
    <MemberData
      providers={shown}
      allow={settings.ai?.allow ?? {}}
      onChange={(p, a: MemberClass[]) => {
        const all = { ...(useWorkspace.getState().settings.ai?.allow ?? {}) }
        if (a.length) all[p] = a
        else delete all[p]
        setDeviceAI({ allow: Object.keys(all).length ? all : undefined })
      }}
    />
  )
}

/** Usage on this device: today and 30 days per provider (the ledger, read in idle — never at boot). */
function Usage() {
  const t = useT()
  const lang = useLang()
  const [rows, setRows] = useState<{ today: LedgerTotal[]; month: LedgerTotal[] } | null>(null)
  useEffect(() => {
    let alive = true
    const idle = (cb: () => void) => ((window as { requestIdleCallback?: (f: () => void) => number }).requestIdleCallback ? (window as unknown as { requestIdleCallback: (f: () => void) => number }).requestIdleCallback(cb) : window.setTimeout(cb, 200))
    idle(() => {
      const now = Date.now()
      const start = new Date()
      start.setHours(0, 0, 0, 0)
      void Promise.all([ledgerTotals('provider', { from: start.getTime() }), ledgerTotals('provider', { from: now - 30 * 86_400_000 })])
        .then(([today, month]) => alive && setRows({ today, month }))
        .catch(() => alive && setRows({ today: [], month: [] }))
    })
    return () => {
      alive = false
    }
  }, [])
  const usd = (r?: LedgerTotal) => fmtUsd(r?.usd ?? 0, lang)
  return (
    <section className="aip__usage" aria-labelledby="aip-usage" data-testid="settings-usage">
      <h4 className="aip__h" id="aip-usage">
        {t('features.ai.prov.tab.usage')} <span className="label">{t('features.ai.prov.tab.usageHead')}</span>
      </h4>
      {rows && !rows.month.length && <p className="aip__muted">{t('features.ai.prov.tab.usageNone')}</p>}
      {rows?.month.map((m) => {
        const p = m.key as ProviderId
        return (
          <p key={p} className="aip__dline" data-provider={p}>
            <b>{providerInfo(p).name}</b>
            <span>{t('features.ai.prov.tab.usageRow', { today: usd(rows.today.find((r) => r.key === p)), month: usd(m), n: m.requests })}</span>
          </p>
        )
      })}
      {rows?.month.some((m) => m.key === 'openrouter') && OWNER.jevRouter && <p className="aip__muted">{t('features.ai.prov.tab.usageRouter')}</p>}
    </section>
  )
}

/** Which providers connect MCP servers (Claude yes · OpenAI later · OpenRouter none). */
function McpProviders() {
  const t = useT()
  return (
    <p className="aip__mcp" data-testid="mcp-providers">
      <span className="label">{t('features.ai.prov.mcp.label')}</span>
      {PLATE_ORDER.map((p) => (
        <span key={p} className="aip__mcpcell">
          <b>{providerInfo(p).name}</b> {p === 'anthropic' ? t('features.ai.prov.mcp.yes', { company: providerInfo(p).company }) : p === 'openai' ? t('features.ai.prov.mcp.notYet') : t('features.ai.prov.chip.why.mcp')}
        </span>
      ))}
    </p>
  )
}
