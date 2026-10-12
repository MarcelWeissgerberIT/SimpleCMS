/**
 * Step 05 — working together (D-S2-10, the reduced S2 form): who answers what on THIS device. Choices as radio plates,
 * each with a spec plate of exactly what it writes: Leave it as it is · Everything via Claude (this device's rules and
 * default cleared) · One provider for everything: OpenRouter (the device default = its standard role — the Jev Router
 * when that role is it, tier "balanced"; bulk work, the help and memory → its fast role; kinds of work OpenRouter does
 * not take yet stay with Claude and the plate says so) · My own (Settings › AI › This device after closing). Its Undo
 * sits in step 06, inside the dialog (never a toast over its footer). Workspace-wide routing comes with the routing matrix (slice 5).
 */
import { useEffect, useMemo, useState } from 'react'
import type { DeviceAI, FeatureClass, Route } from '@/shared/ai/types'
import { FEATURE_CLASSES } from '@/shared/ai/policy'
import { providerInfo } from '@/shared/ai/providers'
import { isJevRouter } from '@/shared/ai/jev'
import { useWorkspace } from '../../../../store/store'
import { setDeviceAI } from '../../../../store/aiRules'
import { withWriter } from '../../../../store/writer'
import { useT } from '../../../../i18n'
import { routable } from '../../core/routable'
import { labelFor } from '../../core/registry'
import { hasKeyIn, rolesOf, roleRoute } from '../facts'
import { Rich } from '../AINeedsSetup'
import type { StepProps } from '../AISetup'

type Choice = 'keep' | 'claude' | 'openrouter' | 'own'
const FAST: readonly FeatureClass[] = ['bulk', 'help', 'memory']

/** What "One provider for everything: OpenRouter" writes on this device (null: no standard model yet). */
export function oneProviderPlan(): { def: Route; fast: Partial<Record<FeatureClass, Route>> } | null {
  const roles = rolesOf('openrouter')
  if (!roles.standard) return null
  const def = roleRoute('openrouter', 'standard', roles.standard)
  const fast: Partial<Record<FeatureClass, Route>> = {}
  if (roles.fast) for (const c of FAST) fast[c] = roleRoute('openrouter', 'fast', roles.fast)
  return { def, fast }
}

export function TogetherStep({ run, setRun, handle }: StepProps) {
  const t = useT()
  const settings = useWorkspace((s) => s.settings)
  const claudeKey = hasKeyIn(settings, 'anthropic')
  const orReady = hasKeyIn(settings, 'openrouter') && !run.skipped.includes('openrouter')
  const plan = useMemo(() => (orReady ? oneProviderPlan() : null), [orReady, settings.ai?.roles])
  // an OpenRouter-only device answers nothing without a default: preselect it there
  const [choice, setChoice] = useState<Choice>(() => (!claudeKey && orReady ? 'openrouter' : 'keep'))
  const or = providerInfo('openrouter').name
  const stays = FEATURE_CLASSES.filter((c) => c !== 'gate' && !routable('openrouter', c))

  const apply = (): boolean => {
    const s = useWorkspace.getState().settings.ai
    const prior: Partial<DeviceAI> = { routes: s?.routes, default: s?.default }
    let rows = 0
    withWriter({ kind: 'you', via: 'setup' }, () => {
      if (choice === 'claude') {
        setDeviceAI({ routes: undefined, default: undefined })
        rows = Object.keys(prior.routes ?? {}).length + (prior.default ? 1 : 0)
      } else if (choice === 'openrouter' && plan) {
        const routes = { ...(s?.routes ?? {}) }
        for (const [c, r] of Object.entries(plan.fast) as Array<[FeatureClass, Route]>) routes[c] = [r]
        setDeviceAI({ routes, default: [plan.def] })
        rows = 1 + Object.keys(plan.fast).length
      }
    })
    setRun({ afterClose: choice === 'own' ? 'settings' : null, wroteRows: rows, routingUndo: choice === 'claude' || choice === 'openrouter' ? prior : null })
    return true
  }

  useEffect(() => {
    handle({ canNext: choice !== 'openrouter' || !!plan, commit: apply })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choice, plan, handle])

  const label = (r: Route) => (r.p === 'openrouter' && isJevRouter(r.m) ? t('features.ai.prov.jev.role', { tier: t(`features.ai.jev.router.tier.${r.effort ?? 'medium'}`) }) : labelFor(r))
  const options: Array<{ id: Choice; title: string; sub: string; writes: string[]; off?: boolean }> = [
    { id: 'keep', title: t('features.ai.prov.together.keep'), sub: t('features.ai.prov.together.keepSub'), writes: [t('features.ai.prov.together.nothing')] },
    ...(claudeKey ? [{ id: 'claude' as const, title: t('features.ai.prov.together.claude'), sub: t('features.ai.prov.together.claudeSub'), writes: [t('features.ai.prov.together.cleared')] }] : []),
    ...(orReady
      ? [
          {
            id: 'openrouter' as const,
            title: t('features.ai.prov.together.one', { p: or }),
            sub: t('features.ai.prov.together.oneSub'),
            off: !plan,
            writes: plan
              ? [
                  t('features.ai.prov.together.row', { work: t('features.ai.prov.together.default'), model: label(plan.def) }),
                  ...(Object.entries(plan.fast) as Array<[FeatureClass, Route]>).map(([c, r]) => t('features.ai.prov.together.row', { work: t(`features.ai.prov.class.${c}`), model: label(r) })),
                  t('features.ai.prov.together.stays', { list: stays.map((c) => t(`features.ai.prov.class.${c === 'generate' || c === 'mcp-setup' ? 'mcp' : c}`)).filter((v, i, a) => a.indexOf(v) === i).join(', '), p: or }),
                ]
              : [t('features.ai.prov.together.noStandard', { p: or })],
          },
        ]
      : []),
    { id: 'own', title: t('features.ai.prov.together.own'), sub: t('features.ai.prov.together.ownSub'), writes: [t('features.ai.prov.together.nothing')] },
  ]

  return (
    <div className="ait">
      <p className="aiw-lead">
        <Rich text={t('features.ai.prov.together.lead')} />
      </p>
      <div className="ait__opts" role="radiogroup" aria-label={t('features.ai.prov.setup.title.routing')}>
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={choice === o.id}
            aria-disabled={o.off || undefined}
            className="ait-opt"
            data-testid={`together-${o.id}`}
            onClick={() => !o.off && setChoice(o.id)}
            onKeyDown={(e) => {
              const ids = options.filter((x) => !x.off).map((x) => x.id)
              const i = ids.indexOf(choice)
              if (e.key === 'ArrowDown' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
                e.preventDefault()
                const next = ids[(i + (e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1) + ids.length) % ids.length]!
                setChoice(next)
                requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-testid="together-${next}"]`)?.focus())
              }
            }}
            tabIndex={choice === o.id ? 0 : -1}
          >
            <span className="ait-opt__radio" aria-hidden />
            <span className="ait-opt__text">
              <b>{o.title}</b>
              <small>{o.sub}</small>
            </span>
            {choice === o.id && (
              <span className="ait-opt__plate" data-testid="together-writes">
                <span className="label">{t('features.ai.prov.together.writes')}</span>
                {o.writes.map((w) => (
                  <span key={w} className="ait-opt__w">
                    {w}
                  </span>
                ))}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
