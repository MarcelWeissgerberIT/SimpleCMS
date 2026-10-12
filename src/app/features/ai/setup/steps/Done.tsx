/**
 * Step 06 — done (UX § 4.7): a summary plate — per provider its LED, key marker, models (the Jev Router as "Jev Router ·
 * <tier>"), data rule in words and limit — and this device's rules as they are now (step 05's write with its Undo, inside
 * the dialog). Keys: "Test on a page" (closes, the open page's editor gets the AI menu — openAIPanel) · Done (the footer).
 * "Start practice" and "See the routing matrix" come with later slices.
 */
import { useEffect, useState } from 'react'
import { Play } from 'lucide-react'
import type { FeatureClass, ProviderId, Route } from '@/shared/ai/types'
import { presetOf } from '@/shared/ai/policy'
import { providerInfo } from '@/shared/ai/providers'
import { isJevModel, isJevRouter, jevLabel } from '@/shared/ai/jev'
import { useWorkspace } from '../../../../store/store'
import { setDeviceAI } from '../../../../store/aiRules'
import { withWriter } from '../../../../store/writer'
import { Screws } from '../../../../ui/controls'
import { useLang, useT } from '../../../../i18n'
import { fmtUsd } from '../../../../lib/money'
import { parseHash } from '../../../../lib/router'
import { liveEditorOf, openAIPanel } from '../../../../editor'
import { labelFor } from '../../core/registry'
import { hasKeyIn, keyHint, rolesOf, ROLE_KEYS, roleRoute, SHIPPED } from '../facts'
import { CodePlate } from '../ProviderPlate'
import type { StepProps } from '../AISetup'
import { classLabel } from '../../routing/classLabel'

/** Close the assistant and open the AI menu on the page that is open (its editor, at the caret). */
export function testOnPage(close: () => void): void {
  close()
  const route = parseHash(window.location.hash)
  if (route.name !== 'page') return
  setTimeout(() => {
    const ed = liveEditorOf(route.id)
    if (!ed) return
    ed.commands.focus()
    openAIPanel(ed, { mode: 'block' })
  }, 120)
}

export function DoneStep({ run, setRun, handle, close }: StepProps) {
  const t = useT()
  const lang = useLang()
  const settings = useWorkspace((s) => s.settings)
  const ws = useWorkspace((s) => s.ai)
  const [undone, setUndone] = useState(false)
  const shown = SHIPPED.filter((p) => hasKeyIn(settings, p) || run.picked.includes(p))
  useEffect(() => {
    handle({ canNext: true })
  }, [handle])

  const label = (r: Route) => (r.p === 'openrouter' && isJevRouter(r.m) ? t('features.ai.prov.jev.role', { tier: t(`features.ai.jev.router.tier.${r.effort ?? 'medium'}`) }) : labelFor(r))
  /** a role's model inside its provider's block: without the provider's name in front */
  const bare = (r: Route) => {
    const l = label(r)
    const pre = `${providerInfo(r.p).name} · `
    return l.startsWith(pre) ? l.slice(pre.length) : l
  }
  const data = (p: ProviderId) => {
    const rule = ws?.policy?.providers?.[p]
    if (!rule) return p === 'anthropic' ? t('features.ai.prov.preset.allClaude') : t('features.ai.prov.done.nothing')
    const id = presetOf(rule.allow)
    return id === 'none' ? t('features.ai.prov.done.nothing') : t(`features.ai.prov.preset.${id}`)
  }
  const limit = (p: ProviderId) => {
    const soft = ws?.limits?.[p]?.monthUsd
    return soft !== undefined ? `${fmtUsd(soft, lang)} · ${providerInfo(p).hardLimit[lang]}` : providerInfo(p).hardLimit[lang]
  }
  // one row per label: kinds of work that share one ("MCP tests & media" = generate + mcp-setup) are one row
  const rows: Array<[string, RouteLike]> = []
  const add = (k: string, r: RouteLike | undefined) => {
    if (r && !rows.some(([x]) => x === k)) rows.push([k, r])
  }
  if (settings.ai?.default) add(t('features.ai.prov.tab.default'), settings.ai.default[0])
  // the Vorprüfer has its own line (slice SJ): a decision model, for agents' proposals only
  for (const [c, r] of Object.entries(settings.ai?.routes ?? {}) as Array<[FeatureClass, Route[]]>) if (c !== 'gate') add(classLabel(t, c), r[0])
  const checker = settings.ai?.routes?.gate?.[0]

  return (
    <div className="aidone">
      <p className="aiw-lead">{t('features.ai.prov.done.lead')}</p>
      <div className="aidone__plate screw-plate" data-testid="done-summary">
        <Screws seed="done" />
        {shown.map((p) => {
          const has = hasKeyIn(settings, p)
          const roles = rolesOf(p)
          // Claude: the one model every Claude request of this device goes to (Fast / Deep are not routed in this version)
          const names = ROLE_KEYS.filter((k) => roles[k] && (p !== 'anthropic' || k === 'standard')).map((k) => `${t(`features.ai.prov.role.${k}`)}: ${bare(roleRoute(p, k, roles[k]!))}`)
          return (
            <div key={p} className="aidone__prov" data-provider={p}>
              <span className={has ? 'led led--ok' : 'led'} aria-hidden />
              <CodePlate p={p} />
              <b>{providerInfo(p).name}</b>
              <span className="label">{has ? t('features.ai.prov.keyMarker', { last4: keyHint(settings, p) }) : t('features.ai.prov.done.notSet')}</span>
              {has && (
                <dl className="aidone__spec">
                  <div>
                    <dt>{t('features.ai.prov.done.roles')}</dt>
                    <dd>{names.length ? names.join(' · ') : '—'}</dd>
                  </div>
                  <div>
                    <dt>{t('features.ai.prov.done.data')}</dt>
                    <dd data-testid={`done-data-${p}`}>{data(p)}</dd>
                  </div>
                  <div>
                    <dt>{t('features.ai.prov.done.limit')}</dt>
                    <dd>{limit(p)}</dd>
                  </div>
                </dl>
              )}
            </div>
          )
        })}
        <div className="aidone__rows">
          <span className="label">{t('features.ai.prov.done.rows')}</span>
          {rows.length ? (
            <ul>
              {rows.map(([k, r]) => (
                <li key={k}>{t('features.ai.prov.together.row', { work: k, model: label(r) })}</li>
              ))}
            </ul>
          ) : (
            <p>{t('features.ai.prov.done.noRows')}</p>
          )}
          {checker && isJevModel(checker.m) && (
            <p className="aidone__checker" data-testid="done-checker">
              {t('features.ai.prov.done.checker', { model: jevLabel(checker.m) })}
            </p>
          )}
          {run.routingUndo !== undefined && run.routingUndo !== null && !undone && (
            <p className="ait-undo" role="status">
              {t('features.ai.prov.together.applied', { n: run.wroteRows ?? 0 })}{' '}
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => {
                  withWriter({ kind: 'you', via: 'undo' }, () => setDeviceAI(run.routingUndo!))
                  setUndone(true)
                  setRun({ routingUndo: null })
                }}
                data-testid="together-undo"
              >
                {t('features.ai.prov.together.undo')}
              </button>
            </p>
          )}
          {undone && <p className="ait-undo" role="status">{t('features.ai.prov.together.undone')}</p>}
        </div>
      </div>
      <div className="aidone__keys">
        <button type="button" className="btn btn--ink" onClick={() => testOnPage(close)} data-testid="done-try">
          <Play size={13} aria-hidden /> {t('features.ai.prov.done.try')}
        </button>
      </div>
    </div>
  )
}

type RouteLike = Route
