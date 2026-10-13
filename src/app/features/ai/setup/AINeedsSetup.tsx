/**
 * <AINeedsSetup>: the one card every "can this run?" surface shows when the answer is no (UX § 3 / § 10.6) — the AI
 * terminal, ⌘K "?", help Ask, autofill, meeting notes, agents, kit fill, the Outbox draft, mail organise, design import,
 * the MCP test, the tour. It reads aiStatus(purpose) (core/gate.ts: the gate's own resolution, nothing sent) and says
 * why in one sentence, with the key that helps: Set up AI (no key) · Set up Claude (this kind of work runs only on
 * Claude in this version) · Change rule (a data rule) · Choose models (no model can) · Reload (rules of a newer build).
 * <FixKeys> renders a refused request's AIError fix (D-S2-37) as keys. Small and on the boot path: the assistant itself
 * is a lazy chunk (openAISetup).
 */
import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react'
import { KeyRound, Play, RotateCw, ShieldAlert, SlidersHorizontal } from 'lucide-react'
import type { DataClass, FeatureClass, ProviderId } from '@/shared/ai/types'
import { providerInfo, shippedProviders } from '@/shared/ai/providers'
import { useWorkspace } from '../../../store/store'
import { aiRulesAllowed } from '../../../store/ai'
import { useT } from '../../../i18n'
import { aiStatus, type AIStatus } from '../core/gate'
import { purposeOf, type PurposeId } from '../core/purposes'
import { isAIDemo, onAIDemo, setAIDemo } from '../core/demoMode'
import type { AIFix } from '../core/errors'
import { openAISetup } from './openAISetup'
import './needs.css'
import { classLabel } from '../routing/classLabel'

/** Text with <b>…</b> pairs from a string (the setup's strings mark bold that way; never HTML otherwise). */
export function Rich({ text }: { text: string }) {
  const parts = text.split(/(<b>[\s\S]*?<\/b>)/g)
  return (
    <>
      {parts.map((p, i) => (p.startsWith('<b>') && p.endsWith('</b>') ? <b key={i}>{p.slice(3, -4)}</b> : <Fragment key={i}>{p}</Fragment>))}
    </>
  )
}

/** aiStatus(purpose), kept current: keys, rules, the device layer, the model and the demo switch. */
export function useAIStatus(purpose: PurposeId): AIStatus {
  const key = useWorkspace((s) => s.settings.aiApiKey)
  const keys = useWorkspace((s) => s.settings.aiKeys)
  const device = useWorkspace((s) => s.settings.ai)
  const ws = useWorkspace((s) => s.ai)
  const model = useWorkspace((s) => s.settings.aiModel)
  const [demo, setDemo] = useState(isAIDemo)
  useEffect(() => onAIDemo(() => setDemo(isAIDemo())), [])
  return useMemo(() => aiStatus(purpose), [purpose, key, keys, device, ws, model, demo])
}

/**
 * Does a surface offer its AI keys? Ready — or refused for a reason the request itself reports with its fix keys
 * (newer rules → Reload, the off switch, a data rule, a capability, a removed model: the gate answers, nothing is sent).
 * Only "no key for this kind of work here" (no_key · route) puts the card up front. A demo answer is not a key.
 */
export const offersAI = (s: AIStatus): boolean => !s.demo && (s.ready || (s.reason !== 'no_key' && s.reason !== 'route'))

/** Why the card shows (aiStatus' reason, or one a caller knows: a request that failed for want of a key). */
export type NeedsReason = AIStatus['reason'] | 'nokey'

export interface AINeedsSetupProps {
  /** the purpose that asks (its kind of work names the card; aiStatus decides the reason when none is given) */
  purpose: PurposeId
  /** a reason the caller already knows (else aiStatus') */
  reason?: NeedsReason
  /** a run that failed: the fix it carried (a data rule's class, a provider) */
  fix?: AIFix | null
  /** 'card' (default) · 'line': one line + the key, for tight places (a placard, a field's hint) */
  variant?: 'card' | 'line'
  /** called before the assistant opens (a popover that must close first) */
  onOpen?: () => void
  /** offer "Try a demo answer (no key)" (the AI menu) */
  onDemo?: () => void
  /** extra content under the body (a surface's own note) */
  children?: ReactNode
  testId?: string
  /**
   * where a panel that focuses its [data-autofocus] puts the keyboard: 'key' (default) — the card's key, so ↵ presses
   * it; 'title' — the title (tabindex -1, not a Tab stop), for a card that may open while the person types (the AI
   * menu: Space on an empty line, `/ai`): no typed key presses a key — Tab moves to them
   */
  focus?: 'key' | 'title'
}

/** The setup step a fix opens (the assistant at the right provider / class). */
export function openFix(fix: AIFix, o: { feature?: FeatureClass } = {}): void {
  if (fix.kind === 'askClaude' || fix.kind === 'pick') return
  if (fix.step === 'key') openAISetup({ reason: 'refused', step: 'key', provider: fix.provider, ...(o.feature ? { feature: o.feature } : {}) })
  else if (fix.step === 'models') openAISetup({ reason: 'models', step: 'models', provider: fix.provider, ...(o.feature ? { feature: o.feature } : {}) })
  else openAISetup({ reason: 'policy', step: 'data', provider: fix.provider, ...(fix.data ? { data: fix.data } : {}), ...(o.feature ? { feature: o.feature } : {}) })
}

/** A team member may change the workspace's shared classes only with admin rights; member classes are their own. */
const memberClass = (c: DataClass | undefined): boolean => c === 'private' || c === 'mail' || c === 'memory' || c === 'mcp'

export function AINeedsSetup({ purpose, reason, fix, variant = 'card', onOpen, onDemo, children, testId, focus = 'key' }: AINeedsSetupProps) {
  const t = useT()
  const status = useAIStatus(purpose)
  const cls = purposeOf(purpose).cls
  const why: NeedsReason = reason ?? status.reason ?? 'no_key'
  const f = fix ?? status.fix ?? null
  const work = classLabel(t, cls)
  const p = f && f.kind === 'step' ? providerInfo(f.provider).name : providerInfo('openrouter').name
  const data = f && f.kind === 'step' ? f.data : undefined
  const open = (run: () => void) => () => {
    onOpen?.()
    run()
  }

  let title: string
  let body: string
  let key: { label: string; icon: ReactNode; run: () => void } | null
  let note: string | null = null
  if (why === 'route') {
    title = t('features.ai.prov.needs.route.title', { work })
    body = t('features.ai.prov.needs.route.body', { work })
    key = { label: t('features.ai.prov.needs.route.open'), icon: <KeyRound size={13} strokeWidth={1.75} aria-hidden />, run: open(() => openAISetup({ reason: 'route', provider: 'anthropic', feature: cls })) }
  } else if (why === 'policy') {
    title = t('features.ai.prov.needs.policy.title', { p })
    body = t('features.ai.prov.needs.policy.body', { p, class: data ? t(`features.ai.cls.${data}`) : work })
    key = { label: t('features.ai.prov.needs.policy.open'), icon: <ShieldAlert size={13} strokeWidth={1.75} aria-hidden />, run: open(() => f && openFix(f, { feature: cls })) }
    if (!aiRulesAllowed() && !memberClass(data)) note = t('features.ai.prov.fix.member')
  } else if (why === 'capability' || why === 'model_gone') {
    title = t('features.ai.prov.needs.models.title')
    body = t('features.ai.prov.needs.models.body')
    const provider = f && f.kind === 'step' ? f.provider : 'openrouter'
    key = { label: t('features.ai.prov.needs.models.open'), icon: <SlidersHorizontal size={13} strokeWidth={1.75} aria-hidden />, run: open(() => openAISetup({ reason: 'models', step: 'models', provider, feature: cls })) }
  } else if (why === 'reload') {
    title = t('features.ai.prov.needs.reload.title')
    body = t('features.ai.prov.needs.reload.body')
    key = { label: t('features.ai.reload'), icon: <RotateCw size={13} strokeWidth={1.75} aria-hidden />, run: () => window.location.reload() }
  } else if (why === 'off') {
    title = t('features.ai.prov.needs.off.title')
    body = t('features.ai.prov.needs.off.body')
    key = null
  } else {
    title = t('features.ai.prov.needs.title')
    // only the providers this build can set up (a listed one that is not shipped yet reads "comes soon" in step 01)
    const names = shippedProviders().map((id) => providerInfo(id).name)
    const list = names.length > 1 ? `${names.slice(0, -1).join(', ')}${t('features.ai.prov.needs.or')}${names[names.length - 1]}` : (names[0] ?? '')
    body = t('features.ai.prov.needs.body', { list, all: t(names.length > 2 ? 'features.ai.prov.needs.several' : 'features.ai.prov.needs.both') })
    key = { label: t('features.ai.prov.needs.open'), icon: <KeyRound size={13} strokeWidth={1.75} aria-hidden />, run: open(() => openAISetup({ reason: 'nokey', feature: cls })) }
  }

  if (variant === 'line')
    return (
      <span className="ai-needs-line" role="note" data-testid={testId ?? 'ai-needs'} data-reason={why}>
        <span className="led" aria-hidden />
        <span className="ai-needs-line__text">{why === 'no_key' || why === 'nokey' ? t('features.ai.prov.needs.line') : title}</span>
        {key && (
          <button type="button" className="ai-needs-line__key" onClick={key.run} data-testid="ai-needs-open">
            {key.label}
          </button>
        )}
      </span>
    )

  return (
    <div className="ai-needs" role="note" data-testid={testId ?? 'ai-needs'} data-reason={why}>
      <div className="ai-needs__head">
        <span className="led" aria-hidden />
        <span className="label">§ {t('features.ai.prov.needs.label')}</span>
      </div>
      <strong className="ai-needs__title" {...(focus === 'title' ? { tabIndex: -1, 'data-autofocus': '' } : {})}>
        {title}
      </strong>
      <p className="ai-needs__body">{body}</p>
      {note && <p className="ai-needs__note">{note}</p>}
      {children}
      {(key || onDemo) && (
        <div className="ai-needs__keys">
          {key && (
            <button type="button" className="btn btn--sm btn--ink" onClick={key.run} data-testid="ai-needs-open" data-autofocus={focus === 'key' ? '' : undefined}>
              {key.icon} {key.label}
            </button>
          )}
          {onDemo && (why === 'no_key' || why === 'nokey') && (
            <button
              type="button"
              className="btn btn--sm"
              data-ai-try-demo=""
              onClick={() => {
                setAIDemo(true)
                onDemo()
              }}
            >
              <Play size={12} strokeWidth={1.8} aria-hidden /> {t('features.ai.prov.needs.demo')}
            </button>
          )}
        </div>
      )}
      {onDemo && (why === 'no_key' || why === 'nokey') && <span className="ai-needs__demo label">{t('features.ai.prov.needs.demoNote')}</span>}
    </div>
  )
}

/**
 * The keys of a refused request's fix (D-S2-37): Check key (step 02 at the provider) · Choose models (step 03) · Change
 * rule (step 04 at the class; a member without admin rights reads who can) · Choose a model that can … (`onPick` opens
 * the route picker, else step 03). "Ask Claude" stays with the caller (it re-runs the request).
 */
export function FixKeys({ fix, onPick, onOpen, feature }: { fix: AIFix | null | undefined; onPick?: () => void; onOpen?: () => void; feature?: FeatureClass }) {
  const t = useT()
  if (!fix || fix.kind === 'askClaude') return null
  const go = (run: () => void) => () => {
    onOpen?.()
    run()
  }
  if (fix.kind === 'pick')
    return (
      <span className="ai-fix">
        <button type="button" className="btn btn--sm" data-testid="ai-fix" data-fix="pick" onClick={onPick ? onPick : go(() => openAISetup({ reason: 'capability', step: 'models', provider: 'openrouter', ...(feature ? { feature } : {}) }))}>
          <SlidersHorizontal size={13} strokeWidth={1.75} aria-hidden /> {t('features.ai.prov.fix.pick', { need: t(`features.ai.prov.need.${fix.need}`) })}
        </button>
      </span>
    )
  const label = fix.step === 'key' ? t('features.ai.prov.fix.key') : fix.step === 'models' ? t('features.ai.prov.fix.models') : t('features.ai.prov.fix.data')
  const member = fix.step === 'data' && !aiRulesAllowed() && !memberClass(fix.data)
  return (
    <span className="ai-fix">
      <button type="button" className="btn btn--sm" data-testid="ai-fix" data-fix={fix.step} onClick={go(() => openFix(fix, { ...(feature ? { feature } : {}) }))}>
        {fix.step === 'key' ? <KeyRound size={13} strokeWidth={1.75} aria-hidden /> : fix.step === 'data' ? <ShieldAlert size={13} strokeWidth={1.75} aria-hidden /> : <SlidersHorizontal size={13} strokeWidth={1.75} aria-hidden />} {label}
      </button>
      {member && <span className="ai-fix__note">{t('features.ai.prov.fix.member')}</span>}
    </span>
  )
}

/** Providers named in fixes (the plates' state uses them). */
export const fixProvider = (fix: AIFix | null | undefined): ProviderId | null => (fix && fix.kind === 'step' ? fix.provider : null)
