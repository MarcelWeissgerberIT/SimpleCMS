/**
 * The assistant "Set up AI" (UX § 4; modal 'aiSetup', a lazy chunk opened by openAISetup()): one step at a time —
 * 01 providers · 02 key & check · 03 models · 04 data & limits · 05 working together · 06 done. A step's choices are
 * written when it is confirmed (Next / ↵), one store update each, so closing keeps what was confirmed; keys are sealed
 * the moment their free check passes. Desktop: a step rail; ≤ 760 px a full-screen sheet with a tick strip. Focus goes
 * to the step's heading, a live region names the step; ↵ = Next (never inside a field), Shift+↵ = Back, Esc closes.
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { Check, X } from 'lucide-react'
import type { DeviceAI, ProviderId } from '@/shared/ai/types'
import { providerInfo } from '@/shared/ai/providers'
import { PRICES_DATE } from '@/shared/ai/prices'
import { useWorkspace } from '../../../store/store'
import type { ModalState, AISetupStep } from '../../../store/ui'
import { Modal } from '../../../ui/Modal'
import { Kbd } from '../../../ui/controls'
import { useLang, useT } from '../../../i18n'
import { hasKeyIn, SHIPPED, useChecks } from './facts'
import { openAISettings } from './openAISetup'
import { Rich } from './AINeedsSetup'
import { ProviderStep } from './steps/Provider'
import { KeyStep } from './steps/Key'
import { ModelsStep } from './steps/Models'
import { DataStep } from './steps/Data'
import { TogetherStep } from './steps/Together'
import { DoneStep } from './steps/Done'
import './setup.css'

export const STEPS: readonly AISetupStep[] = ['provider', 'key', 'models', 'data', 'routing', 'done']

/** What a step tells the frame: may it go on, what Next writes, an extra key for the footer. */
export interface StepHandle {
  canNext: boolean
  /** write this step's choices (false: stay — the step says why) */
  commit?: () => boolean
  /** a secondary footer key ("OpenRouter later") */
  extra?: { label: string; run: () => void; testId?: string } | null
  /** the step's provider tabs: Alt+← / → anywhere in the dialog (the heading, the footer …) but a text field moves them */
  tabs?: ((d: 1 | -1) => void) | null
}

/** The run the steps share (what was picked, skipped, which provider tab is open). */
export interface SetupRun {
  picked: ProviderId[]
  skipped: ProviderId[]
  tab: ProviderId | null
  /** step 05's choice "My own": Settings › AI opens when the assistant closes */
  afterClose?: 'settings' | null
  /** step 05 wrote this many rows (06 lists them) */
  wroteRows?: number
  /** step 05's write: this device's rules before it (06's Undo) */
  routingUndo?: Partial<DeviceAI> | null
}

export interface StepProps {
  run: SetupRun
  setRun: (patch: Partial<SetupRun> | ((r: SetupRun) => Partial<SetupRun>)) => void
  /** the providers of this run: picked or ready (minus skipped), registry order */
  providers: ProviderId[]
  /** report what the frame needs (call on every render that changes it) */
  handle: (h: StepHandle) => void
  /** go to a step (06's keys, a plate's "Change key") */
  go: (s: AISetupStep) => void
  close: () => void
  modal: Extract<ModalState, { type: 'aiSetup' }>
}

/** A field, a picker, a switch or a key: ↵ belongs to it, not to Next. */
function ownsEnter(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  if (el.closest('input, textarea, select, button, a[href], [role="switch"], [role="tab"], [role="option"], [role="menuitem"], [role="radio"], [contenteditable="true"]')) return true
  return !!document.querySelector('[data-popover]')
}

export function AISetupModal({ modal, onClose }: { modal: Extract<ModalState, { type: 'aiSetup' }>; onClose: () => void }) {
  const t = useT()
  const lang = useLang()
  const settings = useWorkspace((s) => s.settings)
  const checks = useChecks()
  const first: AISetupStep = modal.step ?? 'provider'
  const [step, setStep] = useState<AISetupStep>(first)
  const [run, setRunState] = useState<SetupRun>(() => {
    const s = useWorkspace.getState().settings
    const p = modal.provider && providerInfo(modal.provider).shipped ? modal.provider : null
    return { picked: p && !hasKeyIn(s, p) ? [p] : [], skipped: [], tab: p }
  })
  const setRun = useCallback((patch: Partial<SetupRun> | ((r: SetupRun) => Partial<SetupRun>)) => setRunState((r) => ({ ...r, ...(typeof patch === 'function' ? patch(r) : patch) })), [])
  const [reached, setReached] = useState<ReadonlySet<AISetupStep>>(() => new Set(STEPS.slice(0, STEPS.indexOf(first) + 1)))
  const [handle, setHandle] = useState<StepHandle>({ canNext: false })
  const headRef = useRef<HTMLHeadingElement>(null)
  const [live, setLive] = useState('')

  const ready = SHIPPED.filter((p) => hasKeyIn(settings, p))
  const providers = SHIPPED.filter((p) => (run.picked.includes(p) || ready.includes(p)) && !run.skipped.includes(p))
  // step 05 has nothing to decide when only Claude answers (its default is today's)
  const routingSkipped = ready.filter((p) => !run.skipped.includes(p)).every((p) => p === 'anthropic')
  const skippedSteps = new Set<AISetupStep>(routingSkipped ? ['routing'] : [])
  const visible = STEPS
  const index = STEPS.indexOf(step)

  const nextOf = (s: AISetupStep): AISetupStep | null => {
    if (s === 'provider') return run.picked.some((p) => !hasKeyIn(useWorkspace.getState().settings, p)) ? 'key' : 'models'
    const i = STEPS.indexOf(s)
    for (let j = i + 1; j < STEPS.length; j++) if (!skippedSteps.has(STEPS[j]!)) return STEPS[j]!
    return null
  }
  const prevOf = (s: AISetupStep): AISetupStep | null => {
    const i = STEPS.indexOf(s)
    for (let j = i - 1; j >= 0; j--) if (!skippedSteps.has(STEPS[j]!) && reached.has(STEPS[j]!)) return STEPS[j]!
    return i > 0 ? STEPS[i - 1]! : null
  }
  const next = nextOf(step)
  const prev = prevOf(step)

  const go = useCallback((s: AISetupStep) => {
    setStep(s)
    setReached((r) => new Set([...r, s]))
  }, [])

  const close = useCallback(() => {
    onClose()
    if (run.afterClose === 'settings') requestAnimationFrame(() => openAISettings())
  }, [onClose, run.afterClose])

  const doNext = () => {
    if (!handle.canNext) return
    if (handle.commit && handle.commit() === false) return
    if (!next) return close()
    go(next)
  }
  const doBack = () => {
    if (prev) go(prev)
  }

  // a new step: its heading takes the focus, the live region names it
  const titleOf = (s: AISetupStep) => t(`features.ai.prov.setup.title.${s}`)
  useEffect(() => {
    const id = requestAnimationFrame(() => headRef.current?.focus({ preventScroll: true }))
    setLive(t('features.ai.prov.setup.live', { n: index + 1, total: STEPS.length, title: titleOf(step) }))
    return () => cancelAnimationFrame(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    // Alt+← / →: the step's provider tabs — from the heading, the step, the footer; a text field keeps Option+← / →
    if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && handle.tabs) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      e.preventDefault()
      handle.tabs(e.key === 'ArrowRight' ? 1 : -1)
      return
    }
    if (e.key !== 'Enter' || e.nativeEvent.isComposing || e.altKey || e.metaKey || e.ctrlKey || e.repeat) return
    if (ownsEnter(e.target)) return
    e.preventDefault()
    if (e.shiftKey) doBack()
    else doNext()
  }

  const stepProps: StepProps = { run, setRun, providers, handle: setHandle, go, close, modal }
  const sub = (s: AISetupStep): string => {
    if (skippedSteps.has(s)) return t('features.ai.prov.setup.sub.skipped')
    if (s === 'provider') return run.picked.length ? t('features.ai.prov.setup.sub.provider.picked', { n: run.picked.length }) : ready.length ? t('features.ai.prov.setup.sub.provider.ready', { n: ready.length }) : t('features.ai.prov.setup.sub.provider.none')
    if (s === 'key') {
      const ok = providers.filter((p) => hasKeyIn(settings, p) && checks[p]?.state !== 'error').length
      const bad = providers.filter((p) => checks[p]?.state === 'error').length
      return ok || bad ? t('features.ai.prov.setup.sub.key', { ok, bad }) : t('features.ai.prov.setup.sub.keyNone')
    }
    return t(`features.ai.prov.setup.sub.${s}`)
  }
  const state = (s: AISetupStep): 'done' | 'now' | 'todo' | 'skip' => (s === step ? 'now' : skippedSteps.has(s) ? 'skip' : reached.has(s) && STEPS.indexOf(s) < index ? 'done' : reached.has(s) ? 'done' : 'todo')
  const railFoot = (): ReactNode => {
    if (step === 'provider') {
      const claude = ready.includes('anthropic') && !run.picked.length
      return <Rich text={claude ? t('features.ai.prov.setup.foot.providerReady', { p: providerInfo('anthropic').name }) : t('features.ai.prov.setup.foot.provider')} />
    }
    if (step === 'models') return t('features.ai.prov.setup.foot.models', { date: new Date(PRICES_DATE).toLocaleDateString(lang === 'de' ? 'de-DE' : 'en-US', { day: '2-digit', month: '2-digit' }) })
    return <Rich text={t(`features.ai.prov.setup.foot.${step}`)} />
  }
  const hint =
    step === 'key' ? (
      <>
        <Kbd>Alt</Kbd> <Kbd>←</Kbd> <Kbd>→</Kbd> {t('features.ai.prov.setup.hintTabs')}
      </>
    ) : step === 'models' ? (
      <>
        {handle.tabs && (
          <>
            <Kbd>Alt</Kbd> <Kbd>←</Kbd> <Kbd>→</Kbd> {t('features.ai.prov.setup.hintTabs')} ·{' '}
          </>
        )}
        {t('features.ai.prov.setup.hintModels')}
      </>
    ) : (
      <>
        <Kbd>Esc</Kbd> {t('features.ai.prov.setup.hint')}
      </>
    )

  return (
    <Modal open onClose={close} bare className="aiw" ariaLabel={t('features.ai.prov.setup.dialog')}>
      <div className="aiw__frame" onKeyDown={onKeyDown} data-step={step} data-testid="ai-setup">
        <header className="aiw__head">
          <span className="label aiw__label">{t('features.ai.prov.setup.label')}</span>
          <h2 className="aiw__title" ref={headRef} tabIndex={-1} data-testid="ai-setup-title">
            {titleOf(step)}
          </h2>
          <span className="label aiw__count">{t('features.ai.prov.setup.count', { n: String(index + 1).padStart(2, '0'), total: String(STEPS.length).padStart(2, '0') })}</span>
          <button type="button" className="icon-btn aiw__close" onClick={close} aria-label={t('common.close')} data-testid="ai-setup-close">
            <X size={16} />
          </button>
        </header>
        <p className="visually-hidden" role="status" aria-live="polite">
          {live}
        </p>
        <div className="aiw__ticks" aria-hidden>
          {visible.map((s) => (
            <i key={s} data-s={state(s)} />
          ))}
          <span className="label">
            {String(index + 1).padStart(2, '0')} {t(`features.ai.prov.setup.step.${step}`)}
          </span>
        </div>
        <div className="aiw__body">
          <nav className="aiw-rail" aria-label={t('features.ai.prov.setup.rail')}>
            <ol>
              {visible.map((s, i) => {
                const st = state(s)
                const clickable = st === 'done' && s !== step
                const inner = (
                  <>
                    <span className="aiw-st__n">{String(i + 1).padStart(2, '0')}</span>
                    <span className="aiw-st__t">{t(`features.ai.prov.setup.step.${s}`)}</span>
                    {st === 'done' && s !== step ? <Check className="aiw-st__ok" size={13} strokeWidth={2} aria-hidden /> : <span />}
                    <span className="aiw-st__s">{sub(s)}</span>
                  </>
                )
                return (
                  <li key={s}>
                    {clickable ? (
                      <button type="button" className="aiw-st" data-s={st} onClick={() => go(s)}>
                        {inner}
                      </button>
                    ) : (
                      <span className="aiw-st" data-s={st} aria-current={s === step ? 'step' : undefined}>
                        {inner}
                      </span>
                    )}
                  </li>
                )
              })}
            </ol>
            <p className="aiw-rail__foot">{railFoot()}</p>
          </nav>
          <section className="aiw-step" data-testid={`ai-setup-${step}`}>
            {step === 'provider' && <ProviderStep {...stepProps} />}
            {step === 'key' && <KeyStep {...stepProps} />}
            {step === 'models' && <ModelsStep {...stepProps} />}
            {step === 'data' && <DataStep {...stepProps} />}
            {step === 'routing' && <TogetherStep {...stepProps} />}
            {step === 'done' && <DoneStep {...stepProps} />}
          </section>
        </div>
        <footer className="aiw__foot">
          <span className="label aiw__hint">{hint}</span>
          {prev && (
            <button type="button" className="btn aiw__back" onClick={doBack}>
              {t('features.ai.prov.setup.back')}
            </button>
          )}
          {handle.extra && (
            <button type="button" className="btn" onClick={handle.extra.run} data-testid={handle.extra.testId}>
              {handle.extra.label}
            </button>
          )}
          <button type="button" className="btn btn--primary aiw__next" onClick={doNext} aria-disabled={!handle.canNext || undefined} data-testid="ai-setup-next">
            {next ? t('features.ai.prov.setup.next', { step: t(`features.ai.prov.setup.step.${next}`) }) : t('features.ai.prov.setup.finish')}
            <Kbd>↵</Kbd>
          </button>
        </footer>
      </div>
    </Modal>
  )
}

/** Providers' names joined ("Claude, OpenRouter"). */
export const namesOf = (ps: readonly ProviderId[]): string => ps.map((p) => providerInfo(p).name).join(', ')
