/**
 * Step 04 — data & limits (UX § 4.5, design § 10). The data-rules matrix of this run's providers (routing/DataRules):
 * a new provider starts with nothing (OWNER.newProviderStartsEmpty); Claude shows "Everything (as before)" and is written
 * only when touched (D-S2-30; a team's Claude column stays read-only until the server reads Claude rules). One line in
 * words under it ("Private pages only go to: Claude."). "Your own data" — the member classes on this device. OpenRouter's
 * operators (no data collection on, ZDR off, a deny list; naming TypeSafe excludes the Jev Router), what to set at
 * OpenRouter itself, and the limits (the provider's hard limit; One's soft monthly limit). Next: setWorkspaceAI with the
 * touched columns (+ operators, limits) and setDeviceAI (own data, this device's switch-offs) — one update each.
 */
import { useEffect, useMemo, useState } from 'react'
import { ExternalLink, Lock, X } from 'lucide-react'
import type { DataClass, MemberClass, ProviderId, SharedClass, UpstreamRule, WorkspaceAI } from '@/shared/ai/types'
import { OWNER } from '@/shared/ai/owner'
import { allowedFor } from '@/shared/ai/policy'
import { providerInfo, PROVIDERS } from '@/shared/ai/providers'
import { JEV_OPERATOR } from '@/shared/ai/jev'
import { useWorkspace } from '../../../../store/store'
import { aiRulesAllowed, claudeRulesAllowed, setDeviceAI, setWorkspaceAI } from '../../../../store/aiRules'
import { withWriter } from '../../../../store/writer'
import { Switch } from '../../../../ui/controls'
import { useLang, useT } from '../../../../i18n'
import { fmtUsd } from '../../../../lib/money'
import { fmtAmount, parseAmount } from '../../../agents/format'
import { DataRules } from '../../routing/DataRules'
import { MemberData } from '../MemberData'
import { useChecks } from '../facts'
import type { StepProps } from '../AISetup'

const SETUP = { kind: 'you', via: 'setup' } as const

export function DataStep({ providers, handle, modal }: StepProps) {
  const t = useT()
  const lang = useLang()
  const ws = useWorkspace((s) => s.ai)
  const device = useWorkspace((s) => s.settings.ai)
  const checks = useChecks()
  const cols = providers.filter((p) => providerInfo(p).shipped)
  const admin = aiRulesAllowed()
  const claudeOk = claudeRulesAllowed()

  const [allow, setAllow] = useState<Partial<Record<ProviderId, SharedClass[] | null>>>(() => {
    const out: Partial<Record<ProviderId, SharedClass[] | null>> = {}
    for (const p of cols) {
      const rule = ws?.policy?.providers?.[p]
      out[p] = rule ? [...rule.allow] : p === 'anthropic' ? null : OWNER.newProviderStartsEmpty ? [] : ['public', 'structure', 'selection', 'page', 'rows', 'files', 'workspace']
    }
    return out
  })
  const [touched, setTouched] = useState<ReadonlySet<ProviderId>>(() => new Set())
  const [narrow, setNarrow] = useState<Partial<Record<ProviderId, DataClass[]>>>(() => ({ ...(device?.narrow ?? {}) }))
  const [own, setOwn] = useState<Partial<Record<ProviderId, MemberClass[]>>>(() => ({ ...(device?.allow ?? {}) }))
  const [up, setUp] = useState<UpstreamRule>(() => ws?.policy?.providers?.openrouter?.upstream ?? { deny: [], noCollect: true, zdr: false })
  const [upTouched, setUpTouched] = useState(false)
  const [deny, setDeny] = useState('')
  const [soft, setSoft] = useState<Partial<Record<ProviderId, string>>>(() => Object.fromEntries(cols.map((p) => [p, ws?.limits?.[p]?.monthUsd !== undefined ? fmtAmount(ws.limits[p]!.monthUsd, lang) : ''])))
  const [softBad, setSoftBad] = useState<ProviderId | null>(null)

  const lockOf = (p: ProviderId): string | null => (!admin ? t('features.ai.prov.rules.teamLock') : p === 'anthropic' && !claudeOk ? t('features.ai.prov.rules.claudeLocked') : null)

  // the class a refused request named: its cell takes the focus (a frame after the step's heading took it)
  useEffect(() => {
    if (!modal.data || !modal.provider) return
    let id = requestAnimationFrame(() => {
      id = requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-cell="${modal.provider}:${modal.data}"], [data-member="${modal.provider}:${modal.data}"] [role="switch"]`)?.focus())
    })
    return () => cancelAnimationFrame(id)
  }, [modal.data, modal.provider])

  /** the rules as they would be after Next (for the line in words) */
  const nextWs = useMemo((): WorkspaceAI => {
    const providersRule = { ...(ws?.policy?.providers ?? {}) }
    for (const p of cols) {
      const a = allow[p]
      if (a === null || a === undefined) continue
      if (!touched.has(p) && !ws?.policy?.providers?.[p] && p === 'anthropic') continue
      providersRule[p] = { ...(providersRule[p] ?? {}), allow: a, ...(p === 'openrouter' ? { upstream: up } : {}) }
    }
    return { ...(ws ?? {}), policy: { providers: providersRule, restricted: ws?.policy?.restricted ?? [] } }
  }, [ws, cols.join(), allow, touched, up])
  const nextDev = { ...(device ?? {}), allow: own, narrow }
  const onlyTo = (cls: 'private' | 'mail') => {
    const who = cols.filter((p) => allowedFor(p, cls, nextWs, nextDev)).map((p) => providerInfo(p).name)
    return t('features.ai.prov.rules.onlyTo', { class: t(`features.ai.cls.${cls}`), list: who.length ? who.join(', ') : t('features.ai.prov.rules.nobody') })
  }

  useEffect(() => {
    handle({
      canNext: true,
      commit: () => {
        // soft limits: amounts in the UI's language
        const limits = { ...(ws?.limits ?? {}) }
        let limitsChanged = false
        for (const p of cols) {
          const raw = (soft[p] ?? '').trim()
          const was = ws?.limits?.[p]?.monthUsd
          if (!raw) {
            if (was !== undefined) {
              delete limits[p]
              limitsChanged = true
            }
            continue
          }
          const n = parseAmount(raw, lang)
          if (n === null || n <= 0) {
            setSoftBad(p)
            return false
          }
          if (n !== was) {
            limits[p] = { monthUsd: n }
            limitsChanged = true
          }
        }
        const sharedChanged = touched.size > 0 || upTouched || limitsChanged
        withWriter(SETUP, () => {
          if (admin && sharedChanged)
            setWorkspaceAI((prev) => {
              const providersRule = { ...(prev?.policy?.providers ?? {}) }
              for (const p of touched) {
                const a = allow[p]
                if (a === null || a === undefined) continue
                providersRule[p] = { ...(providersRule[p] ?? {}), allow: a }
              }
              if (upTouched || (touched.has('openrouter') && !providersRule.openrouter?.upstream)) providersRule.openrouter = { ...(providersRule.openrouter ?? { allow: [] }), upstream: up }
              return { ...(prev ?? {}), policy: { providers: providersRule, restricted: prev?.policy?.restricted ?? [] }, ...(Object.keys(limits).length ? { limits } : { limits: undefined }) }
            })
          const cleanNarrow = Object.fromEntries(Object.entries(narrow).filter(([, v]) => v && v.length)) as Partial<Record<ProviderId, DataClass[]>>
          const cleanOwn = Object.fromEntries(Object.entries(own).filter(([, v]) => v && v.length)) as Partial<Record<ProviderId, MemberClass[]>>
          if (JSON.stringify(cleanNarrow) !== JSON.stringify(device?.narrow ?? {}) || JSON.stringify(cleanOwn) !== JSON.stringify(device?.allow ?? {}))
            setDeviceAI({ narrow: Object.keys(cleanNarrow).length ? cleanNarrow : undefined, allow: Object.keys(cleanOwn).length ? cleanOwn : undefined })
        })
        return true
      },
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allow, touched, narrow, own, up, upTouched, soft, handle, lang])

  const empty = cols.filter((p) => p !== 'anthropic' && (allow[p]?.length ?? 0) === 0)
  const denyHasJev = up.deny.some((d) => d.trim().toLowerCase() === JEV_OPERATOR.toLowerCase())
  const orCredit = checks.openrouter?.credit

  return (
    <div className="aid">
      {!admin && (
        <p className="aid-lock" role="note">
          <Lock size={13} aria-hidden /> {t('features.ai.prov.rules.teamLock')} · {t('features.ai.prov.rules.stricterHint')}
        </p>
      )}
      <DataRules
        providers={cols}
        allow={allow}
        narrow={narrow}
        lockOf={lockOf}
        onAllow={(p, a) => {
          setAllow((s) => ({ ...s, [p]: a }))
          setTouched((s) => new Set([...s, p]))
        }}
        onNarrow={(p, cls, off) => setNarrow((s) => ({ ...s, [p]: off ? [...new Set([...(s[p] ?? []), cls])] : (s[p] ?? []).filter((c) => c !== cls) }))}
      />
      {empty.map((p) => (
        <p key={p} className="aid-empty" role="note" data-testid={`empty-${p}`}>
          {t('features.ai.prov.rules.empty', { p: providerInfo(p).name })}
        </p>
      ))}
      <p className="aid-words" data-testid="rules-words">
        {onlyTo('private')} {onlyTo('mail')}
      </p>
      <MemberData providers={cols} allow={own} onChange={(p, a) => setOwn((s) => ({ ...s, [p]: a }))} />
      {cols.includes('openrouter') && (
        <section className="aid-up" aria-labelledby="aid-up-title" data-testid="upstream">
          <span id="aid-up-title" className="label">
            {t('features.ai.prov.up.title')} · {providerInfo('openrouter').name}
          </span>
          <div className="aid-up__row">
            <Switch
              seed="up-nocollect"
              size="sm"
              checked={up.noCollect}
              disabled={!admin}
              label={t('features.ai.prov.up.noCollect')}
              onChange={(v) => {
                setUp((u) => ({ ...u, noCollect: v }))
                setUpTouched(true)
              }}
            />
            <span>{t('features.ai.prov.up.noCollect')}</span>
          </div>
          <div className="aid-up__row">
            <Switch
              seed="up-zdr"
              size="sm"
              checked={up.zdr}
              disabled={!admin}
              label={t('features.ai.prov.up.zdr')}
              onChange={(v) => {
                setUp((u) => ({ ...u, zdr: v }))
                setUpTouched(true)
              }}
            />
            <span>
              {t('features.ai.prov.up.zdr')} <small>· {t('features.ai.prov.up.zdrNote')}</small>
            </span>
          </div>
          <form
            className="aid-up__deny"
            onSubmit={(e) => {
              e.preventDefault()
              const v = deny.trim().slice(0, 80)
              if (!v || !admin) return
              setUp((u) => ({ ...u, deny: [...new Set([...u.deny, v])].slice(0, 50) }))
              setUpTouched(true)
              setDeny('')
            }}
          >
            <label className="label" htmlFor="aid-deny">
              {t('features.ai.prov.up.deny')}
            </label>
            <span className="aid-up__field">
              <input id="aid-deny" className="input aid-up__input" value={deny} disabled={!admin} onChange={(e) => setDeny(e.target.value)} placeholder={t('features.ai.prov.up.denyField')} />
              <button type="submit" className="btn btn--sm" disabled={!admin || !deny.trim()}>
                {t('features.ai.prov.up.denyAdd')}
              </button>
            </span>
            {up.deny.length > 0 && (
              <span className="aid-up__chips">
                {up.deny.map((d) => (
                  <span key={d} className="tag aid-chip" data-testid="deny-chip">
                    {d}
                    {d.trim().toLowerCase() === JEV_OPERATOR.toLowerCase() && <small> · {t('features.ai.prov.up.typesafe')}</small>}
                    {admin && (
                      <button
                        type="button"
                        className="aid-chip__x"
                        aria-label={t('features.ai.prov.up.denyRemove', { name: d })}
                        onClick={() => {
                          setUp((u) => ({ ...u, deny: u.deny.filter((x) => x !== d) }))
                          setUpTouched(true)
                        }}
                      >
                        <X size={11} aria-hidden />
                      </button>
                    )}
                  </span>
                ))}
              </span>
            )}
          </form>
          {OWNER.jevRouter && <p className="aid-note">{denyHasJev ? `Jev Router — ${t('features.ai.prov.up.typesafe')}` : t('features.ai.prov.up.jev')}</p>}
          {OWNER.jevRouter && <p className="aid-note aid-note--q">{PROVIDERS.openrouter.routerPrivacy[lang]}</p>}
          <div className="aid-acct">
            <span className="label">{t('features.ai.prov.acct.title')}</span>
            <p>{t('features.ai.prov.acct.body')}</p>
            <a href={PROVIDERS.openrouter.privacyUrl} target="_blank" rel="noreferrer noopener" className="aik-link">
              {t('features.ai.prov.acct.logging')}
            </a>
            <a href={PROVIDERS.openrouter.pluginsUrl} target="_blank" rel="noreferrer noopener" className="aik-link">
              {t('features.ai.prov.acct.plugins')}
            </a>
            <a href={PROVIDERS.openrouter.privacyUrl} target="_blank" rel="noreferrer noopener" className="aik-link">
              {t('features.ai.prov.acct.providers')}
            </a>
          </div>
        </section>
      )}
      <section className="aid-lim" aria-labelledby="aid-lim-title" data-testid="limits">
        <span id="aid-lim-title" className="label">
          {t('features.ai.prov.lim.title')}
        </span>
        {cols.map((p) => {
          const info = providerInfo(p)
          return (
            <div key={p} className="aid-lim__row">
              <b>{info.name}</b>
              <span className="aid-lim__hard">
                <span className="label">{t('features.ai.prov.lim.hard')}</span>
                {p === 'openrouter' && orCredit
                  ? orCredit.limit !== null
                    ? t('features.ai.prov.lim.live', { used: fmtUsd(orCredit.used, lang), limit: fmtUsd(orCredit.limit, lang) })
                    : t('features.ai.prov.lim.liveNone', { used: fmtUsd(orCredit.used, lang) })
                  : info.hardLimit[lang]}{' '}
                <a href={info.limitUrl} target="_blank" rel="noreferrer noopener" className="aik-link" aria-label={info.hardLimit[lang]}>
                  <ExternalLink size={11} aria-hidden />
                </a>
              </span>
              <label className="aid-lim__soft">
                <span className="label">{t('features.ai.prov.lim.soft')}</span>
                <span className="aid-lim__field">
                  <input
                    className="input aid-lim__input"
                    inputMode="decimal"
                    value={soft[p] ?? ''}
                    disabled={!admin}
                    aria-invalid={softBad === p || undefined}
                    aria-label={t('features.ai.prov.lim.softField', { p: info.name })}
                    onChange={(e) => {
                      setSoft((s) => ({ ...s, [p]: e.target.value }))
                      if (softBad === p) setSoftBad(null)
                    }}
                  />
                  <span className="aid-lim__unit">$</span>
                </span>
              </label>
              {softBad === p && (
                <p className="aid-lim__bad" role="alert">
                  {t('features.ai.prov.lim.bad')}
                </p>
              )}
            </div>
          )
        })}
        <p className="aid-note">{t('features.ai.prov.lim.softHint')}</p>
      </section>
    </div>
  )
}
