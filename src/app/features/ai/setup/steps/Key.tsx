/**
 * Step 02 — keys & check (UX § 4.3). Provider tabs (one tab stop, ←/→ inside, Alt+←/→ from anywhere but the key
 * field, where Option+← / → moves by words). Left: how to get access — Claude: the numbered how-to + the key field +
 * Check; OpenRouter: A "Connect account" (PKCE, from the key press itself — openrouterConnect.ts) or B paste a key.
 * A pasted key is sealed only once the free check passes (no text is sent: Claude's model list, OpenRouter's /key); a
 * key from the exchange is always kept (D-S2-33) and its check shown; the old key stays until a new one passes. Right:
 * the check bench — a row per provider (valid · connected with the key's limit · the error help with its keys), and
 * "Send a test sentence" (purpose setup.test on each provider's fast model, its receipt inline). Next: every picked
 * provider ready or put off ("<P> later").
 */
import { Suspense, useCallback, useEffect, useId, useRef, useState } from 'react'
import { ExternalLink, Eye, EyeOff, LockKeyhole, Loader2, Check as CheckIcon } from 'lucide-react'
import type { ProviderId } from '@/shared/ai/types'
import type { AIErrorCode } from '@/shared/ai/errors'
import { keyOfOther, providerInfo, PROVIDERS } from '@/shared/ai/providers'
import { useWorkspace } from '../../../../store/store'
import { withWriter, type Writer } from '../../../../store/writer'
import { keyLimitUrl } from '../../../../store/secrets'
import { Screws } from '../../../../ui/controls'
import { useLang, useT } from '../../../../i18n'
import type { Lang } from '@/shared/i18n'
import { fmtCost, fmtUsd } from '../../../../lib/money'
import { HelpLink } from '../../../../help'
import { verifyProvider } from '../../core/verify'
import { connectOpenRouter, cancelOpenRouter, useORConnect } from '../../providers/openrouterConnect'
import { runAI } from '../../client'
import { BrakeSlot } from '../../../governor'
import { ReceiptLine } from '../../Receipt'
import type { Receipt } from '../../core/meter'
import { claudeRoles, hasKeyIn, keyHint, NO_ROWS, rolesOf, setCheck, shortAnswerUsd, useChecks, type CheckState } from '../facts'
import { helpFor, type HelpKey } from '../errors'
import { CodePlate } from '../ProviderPlate'
import { dropKey } from '../remove'
import { Rich } from '../AINeedsSetup'
import { MODELS } from '@/shared/ai/models'
import type { StepProps } from '../AISetup'

const SETUP: Writer = { kind: 'you', via: 'setup' }

/** Seal a provider's key (the store keeps its marker). */
function seal(p: ProviderId, key: string) {
  withWriter(SETUP, () => {
    const set = useWorkspace.getState().updateSettings
    if (p === 'anthropic') set({ aiApiKey: key })
    else set({ aiKeys: { [p]: key } })
  })
}

/** The free check of a provider's key here (no text sent); a pasted `key` is sealed only when it passes. */
export async function runCheck(p: ProviderId, key?: string): Promise<CheckState> {
  setCheck(p, { state: 'checking', at: Date.now() })
  const r = await verifyProvider(p, key).catch((): { ok: false; code: AIErrorCode } => ({ ok: false, code: 'offline' }))
  // a key without credit is a valid key (OpenRouter 402)
  const valid = r.ok || (p === 'openrouter' && r.code === 'no_credit')
  if (key && valid) seal(p, key.trim())
  const out: CheckState = r.ok ? { state: 'valid', ...(r.credit ? { credit: r.credit } : {}), at: Date.now() } : { state: 'error', code: r.code, at: Date.now() }
  setCheck(p, out)
  return out
}

const time = (at: number, lang: string) => new Date(at).toLocaleTimeString(lang === 'de' ? 'de-DE' : 'en-US', { hour: '2-digit', minute: '2-digit' })

export function KeyStep({ run, setRun, handle }: StepProps) {
  const t = useT()
  const settings = useWorkspace((s) => s.settings)
  const checks = useChecks()
  const ready = (p: ProviderId) => hasKeyIn(settings, p)
  const tabs = (['anthropic', 'openai', 'openrouter'] as const).filter((p) => providerInfo(p).shipped && (run.picked.includes(p) || ready(p)))
  const active: ProviderId = run.tab && tabs.includes(run.tab as (typeof tabs)[number]) ? run.tab : (tabs.find((p) => run.picked.includes(p) && !ready(p)) ?? tabs[0] ?? 'anthropic')
  const tabRefs = useRef(new Map<ProviderId, HTMLButtonElement>())
  const fieldRef = useRef<HTMLInputElement>(null)

  // ready providers of the run get their free check once (nothing is sent but the check)
  useEffect(() => {
    for (const p of tabs) if (ready(p) && !useChecks.getState()[p]) void runCheck(p)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pending = run.picked.filter((p) => !ready(p) && !run.skipped.includes(p))
  const anyReady = tabs.some((p) => ready(p) && !run.skipped.includes(p))
  const canNext = pending.length === 0 && anyReady
  const later = run.picked.includes(active) && !ready(active) && !run.skipped.includes(active)
  useEffect(() => {
    handle({
      canNext,
      // Alt+← / → from anywhere in the dialog (the frame, AISetup.tsx)
      tabs: tabs.length > 1 ? move : null,
      extra: later
        ? {
            label: t('features.ai.prov.setup.skip', { p: providerInfo(active).name }),
            testId: 'setup-later',
            run: () => setRun((r) => ({ skipped: [...new Set([...r.skipped, active])], tab: tabs.find((p) => p !== active && r.picked.includes(p) && !ready(p) && !r.skipped.includes(p)) ?? r.tab })),
          }
        : null,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canNext, later, active, tabs.join(), handle, t])

  const select = (p: ProviderId, focus = true) => {
    setRun({ tab: p })
    if (focus) requestAnimationFrame(() => tabRefs.current.get(p)?.focus())
  }
  const move = (d: number) => {
    const i = tabs.indexOf(active as (typeof tabs)[number])
    const next = tabs[(i + d + tabs.length) % tabs.length]
    if (next) select(next)
  }
  return (
    <div className="aik">
      <div className="ptabs" role="tablist" aria-label={t('features.ai.prov.key.tabs')}>
        {tabs.map((p) => {
          const c = checks[p]
          const glyph =
            c?.state === 'checking' ? (
              <Loader2 size={13} className="ptab__spin" aria-hidden />
            ) : c?.state === 'error' ? (
              <span className="label ptab__bad">{helpFor(c.code ?? 'unknown', p).cap}</span>
            ) : ready(p) ? (
              <CheckIcon size={13} className="ptab__ok" aria-hidden />
            ) : run.skipped.includes(p) ? (
              <span className="label">—</span>
            ) : null
          return (
            <button
              key={p}
              ref={(el) => {
                if (el) tabRefs.current.set(p, el)
              }}
              type="button"
              role="tab"
              className="ptab"
              aria-selected={p === active}
              tabIndex={p === active ? 0 : -1}
              data-testid={`key-tab-${p}`}
              onClick={() => select(p, false)}
              onKeyDown={(e) => {
                if (e.altKey) return
                if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                  e.preventDefault()
                  move(e.key === 'ArrowRight' ? 1 : -1)
                }
              }}
            >
              <CodePlate p={p} />
              <span className="ptab__name">{providerInfo(p).name}</span>
              {glyph}
            </button>
          )
        })}
      </div>
      <div className="aik-grid" role="tabpanel" aria-label={providerInfo(active).name}>
        <div className="aik-grid__access">
          {active === 'openrouter' ? <ConnectPath /> : null}
          <PastePath p={active} quiet={active === 'openrouter'} fieldRef={fieldRef} />
          <p className="aik-vault">
            <LockKeyhole size={13} strokeWidth={1.7} aria-hidden />
            <span>{t('features.ai.prov.key.vault', { host: providerInfo(active).host })}</span>
          </p>
          <CostCard p={active} />
        </div>
        <Bench providers={tabs} skipped={run.skipped} onNewPaste={(p) => (select(p, false), requestAnimationFrame(() => fieldRef.current?.focus()))} onLater={(p) => setRun((r) => ({ skipped: [...new Set([...r.skipped, p])] }))} />
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Path A: connect OpenRouter (PKCE)                                    */
/* ------------------------------------------------------------------ */

function ConnectPath() {
  const t = useT()
  const lang = useLang()
  const st = useORConnect()
  const hint = useWorkspace((s) => keyHint(s.settings, 'openrouter'))
  const connected = !!hint && st.phase === 'done' && !st.discarded
  // the exchange's own check feeds the bench (402 = a valid key without credit)
  useEffect(() => {
    if (st.phase !== 'done' || !st.check) return
    setCheck('openrouter', st.check.ok ? { state: 'valid', ...(st.check.credit ? { credit: st.check.credit } : {}), at: st.at } : { state: 'error', code: st.check.code, at: st.at })
  }, [st.phase, st.check, st.at])
  return (
    <section className="aik-path" data-done={connected || undefined} data-testid="or-connect">
      <span className="aik-path__n" aria-hidden>
        A
      </span>
      <h4>
        {t('features.ai.prov.key.connect')} <span className="tag aik-path__tag">{t('features.ai.prov.key.recommended')}</span>
      </h4>
      <p>{t('features.ai.prov.key.connectWhy')}</p>
      {connected ? (
        <div className="aik-conn" role="status">
          <span className="led led--ok" aria-hidden />
          <b>{t('features.ai.prov.key.connected', { time: time(st.at, lang) })}</b>
          <span className="mono">{t('features.ai.prov.key.connectedKey', { last4: hint })}</span>
          <span className="aik-conn__sp" />
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            onClick={() => {
              dropKey('openrouter')
              useORConnect.setState({ phase: 'idle', at: Date.now() }, true)
            }}
            data-testid="or-disconnect"
          >
            {t('features.ai.prov.key.disconnect')}
          </button>
        </div>
      ) : st.phase === 'waiting' || st.phase === 'working' ? (
        <div className="aik-conn" role="status">
          <Loader2 size={13} className="ptab__spin" aria-hidden />
          <span>{st.phase === 'waiting' ? t('features.ai.prov.key.connecting') : t('features.ai.prov.key.working')}</span>
          <span className="aik-conn__sp" />
          {st.phase === 'waiting' && (
            <button type="button" className="btn btn--sm btn--ghost" onClick={cancelOpenRouter}>
              {t('features.ai.prov.key.cancel')}
            </button>
          )}
        </div>
      ) : (
        <>
          {st.phase === 'error' && st.issue && (
            <p className="aik-path__issue" role="alert" data-testid="or-issue" data-issue={st.issue}>
              {t(`features.ai.or.err.${st.issue}`, { workspace: st.workspace ?? '' })}
            </p>
          )}
          {st.phase === 'done' && st.discarded && (
            <p className="aik-path__issue" role="alert">
              {t('features.ai.or.err.invalid_key')}{' '}
              <a href={PROVIDERS.openrouter.keyUrl} target="_blank" rel="noreferrer noopener">
                {t('features.ai.or.deleteKey')}
              </a>
            </p>
          )}
          <button type="button" className="btn btn--ink" data-testid="or-connect-key" onClick={() => void connectOpenRouter()}>
            {st.phase === 'error' || st.discarded ? t('features.ai.prov.key.again') : t('features.ai.prov.key.connect')}
          </button>
        </>
      )}
      {!hint && st.phase === 'idle' && st.at > 0 && (
        <p className="aik-path__issue">
          <a href={PROVIDERS.openrouter.keyUrl} target="_blank" rel="noreferrer noopener" data-testid="or-delete-key">
            {t('features.ai.prov.tab.deleteAtOR')}
          </a>
        </p>
      )}
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* Path B: paste a key                                                  */
/* ------------------------------------------------------------------ */

function PastePath({ p, quiet, fieldRef }: { p: ProviderId; quiet: boolean; fieldRef: React.RefObject<HTMLInputElement | null> }) {
  const t = useT()
  const info = providerInfo(p)
  const id = useId()
  const [value, setValue] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const has = useWorkspace((s) => hasKeyIn(s.settings, p))
  const hint = useWorkspace((s) => keyHint(s.settings, p))
  const st = useORConnect()
  const viaConnect = p === 'openrouter' && st.phase === 'done' && !st.discarded
  useEffect(() => {
    setValue('')
    setShow(false)
  }, [p])
  const v = value.trim()
  const how1 = t('features.ai.prov.key.how1', { link: '\u0000' }).split('\u0000')
  // another provider's key in this tab: refused before anything is sent (it would reach the wrong company)
  const other = v ? keyOfOther(p, v) : null
  const soft = !other && v.length > 6 && !v.startsWith(info.keyPrefix)
  const check = async () => {
    if (!v || busy || other) return
    setBusy(true)
    const r = await runCheck(p, v)
    setBusy(false)
    if (r.state === 'valid' || (r.state === 'error' && r.code === 'no_credit' && p === 'openrouter')) setValue('')
  }
  return (
    <section className={quiet ? 'aik-path aik-path--quiet' : 'aik-path'} data-testid={`paste-${p}`}>
      <span className="aik-path__n" aria-hidden>
        {quiet ? 'B' : '1'}
      </span>
      <h4>{quiet ? t('features.ai.prov.key.paste') : t('features.ai.prov.key.pasteOnly')}</h4>
      <ol>
        <li>
          {how1[0]}
          <a href={info.keyUrl} target="_blank" rel="noreferrer noopener" className="aik-link">
            {info.keyUrl.replace(/^https:\/\//, '')} <ExternalLink size={11} aria-hidden />
          </a>
          {how1[1]}
        </li>
        <li>
          <Rich text={t(`features.ai.prov.key.how2.${p === 'openrouter' ? 'openrouter' : 'anthropic'}`)} />
        </li>
        <li>{t('features.ai.prov.key.how3', { prefix: info.keyPrefix })}</li>
      </ol>
      <form
        className="aik-secret"
        onSubmit={(e) => {
          e.preventDefault()
          void check()
        }}
      >
        <label className="visually-hidden" htmlFor={id}>
          {t('features.ai.prov.key.field', { p: info.name })}
        </label>
        <span className="aik-secret__box">
          <input
            ref={fieldRef}
            id={id}
            className="input aik-secret__input"
            type={show ? 'text' : 'password'}
            autoComplete="off"
            spellCheck={false}
            placeholder={`${info.keyPrefix}…`}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            data-testid={`key-field-${p}`}
            aria-describedby={other ? `${id}-other` : soft ? `${id}-soft` : undefined}
            aria-invalid={other ? true : undefined}
          />
          <button type="button" className="icon-btn aik-secret__eye" onClick={() => setShow((s) => !s)} aria-label={show ? t('features.ai.prov.key.hide') : t('features.ai.prov.key.show')} aria-pressed={show}>
            {show ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
          </button>
        </span>
        <button type="submit" className="btn" disabled={!v || busy || !!other} data-testid={`key-check-${p}`}>
          {busy ? t('features.ai.prov.key.checking') : t('features.ai.prov.key.check')}
        </button>
      </form>
      {other && (
        <p className="aik-soft aik-soft--wrong" id={`${id}-other`} role="alert" data-testid={`key-other-${p}`}>
          {t('features.ai.prov.key.other', { company: providerInfo(other).company, prefix: providerInfo(other).keyPrefix, p: providerInfo(other).name, here: info.name })}
        </p>
      )}
      {soft && (
        <p className="aik-soft" id={`${id}-soft`}>
          {t('features.ai.prov.key.soft', { company: info.company, prefix: info.keyPrefix })}
        </p>
      )}
      {has && v && <p className="aik-soft">{t('features.ai.prov.key.kept')}</p>}
      {has && !v && hint && !viaConnect && (
        <p className="aik-sealed" data-testid={`key-sealed-${p}`}>
          <LockKeyhole size={12} aria-hidden /> <span>{t('features.ai.prov.key.sealed', { last4: hint })}</span>
        </p>
      )}
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* What does it cost?                                                   */
/* ------------------------------------------------------------------ */

function CostCard({ p }: { p: ProviderId }) {
  const t = useT()
  const lang = useLang()
  const list = useWorkspace((s) => s.settings.ai?.models ?? NO_ROWS)
  const [limitUrl, setLimitUrl] = useState<string>(providerInfo(p).limitUrl)
  const has = useWorkspace((s) => hasKeyIn(s.settings, p))
  useEffect(() => {
    let alive = true
    setLimitUrl(providerInfo(p).limitUrl)
    if (p === 'openrouter' && has) void keyLimitUrl(p).then((u) => alive && u && setLimitUrl(u))
    return () => {
      alive = false
    }
  }, [p, has])
  let body: string
  if (p === 'openrouter') {
    const cheapest = [...list].filter((r) => r.price).sort((a, b) => (a.price!.input + a.price!.output) - (b.price!.input + b.price!.output))[0]
    const usd = cheapest ? shortAnswerUsd({ p, m: cheapest.m }, cheapest.price) : null
    body = cheapest && usd !== null ? t('features.ai.prov.key.cost.openrouter', { model: cheapest.label, usd: fmtCost(usd, lang) }) : t('features.ai.prov.key.cost.openrouterNone')
  } else {
    const fast = claudeRoles().fast
    const row = MODELS.find((m) => m.route.p === 'anthropic' && m.route.m === fast)
    const usd = row ? shortAnswerUsd(row.route, row.price) : null
    body = t('features.ai.prov.key.cost.anthropic', { model: row?.label ?? '', usd: usd !== null ? fmtCost(usd, lang) : '—' })
  }
  return (
    <div className="aik-cost">
      <span className="label">{t('features.ai.prov.key.cost')}</span>
      <p>
        <Rich text={body} />
      </p>
      <p className="aik-cost__tip">
        {t('features.ai.prov.key.limitTip')}{' '}
        <a href={limitUrl} target="_blank" rel="noreferrer noopener" className="aik-link" data-testid="limit-link">
          {t('features.ai.prov.key.limitLink')}
        </a>
      </p>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* The check bench                                                      */
/* ------------------------------------------------------------------ */

function Bench({ providers, skipped, onNewPaste, onLater }: { providers: readonly ProviderId[]; skipped: readonly ProviderId[]; onNewPaste: (p: ProviderId) => void; onLater: (p: ProviderId) => void }) {
  const t = useT()
  const lang = useLang()
  const settings = useWorkspace((s) => s.settings)
  const checks = useChecks()
  const [tests, setTests] = useState<Partial<Record<ProviderId, { ms: number; receipt: Receipt | null; error?: string; note?: string }>>>({})
  const [testing, setTesting] = useState(false)
  const readyNow = providers.filter((p) => hasKeyIn(settings, p) && !skipped.includes(p) && checks[p]?.state !== 'error')
  const testRoute = (p: ProviderId) => {
    if (p === 'anthropic') return { p, m: claudeRoles().fast }
    const fast = rolesOf(p).fast ?? settings.ai?.models?.[0]?.m
    return fast ? { p, m: fast } : null
  }
  // a provider without a fast model yet (OpenRouter before step 03) is not testable: its row says so, nothing is sent
  const testable = readyNow.filter((p) => !!testRoute(p))
  /** a test sentence refused at the Regler's red line (nothing was sent): the brake note under the rows */
  const [brake, setBrake] = useState<{ p: ProviderId; error: unknown } | null>(null)
  const testKey = useRef<HTMLButtonElement>(null)
  const testOne = async (p: ProviderId) => {
    const route = testRoute(p)
    if (!route) {
      setTests((s) => ({ ...s, [p]: { ms: 0, receipt: null, note: t('features.ai.prov.check.sentenceModels') } }))
      return
    }
    const t0 = performance.now()
    let receipt: Receipt | null = null
    try {
      await runAI({ action: 'custom', purpose: 'setup.test', sources: [], input: '', instruction: 'Reply with the single word OK.', mcp: false, route, onRun: (r) => (receipt = r) })
      setTests((s) => ({ ...s, [p]: { ms: Math.round(performance.now() - t0), receipt } }))
    } catch (e) {
      setTests((s) => ({ ...s, [p]: { ms: 0, receipt, error: e instanceof Error ? e.message : String(e) } }))
      if ((e as { code?: unknown } | null)?.code === 'budget') setBrake((b) => b ?? { p, error: e })
    }
  }
  const sentence = async () => {
    setTesting(true)
    setBrake(null)
    for (const p of readyNow) await testOne(p)
    setTesting(false)
  }
  return (
    <section className="aik-bench" aria-labelledby="aik-bench" data-testid="check-bench">
      <div className="aik-bench__head">
        <Screws seed="bench" count={2} />
        <span className="label" id="aik-bench">
          {t('features.ai.prov.check.title')}
        </span>
        <span className="aik-bench__sp" />
        <span className="label aik-bench__free">{t('features.ai.prov.check.free')}</span>
      </div>
      <div aria-live="polite">
        {providers.map((p) => (
          <BenchRow key={p} p={p} check={checks[p]} has={hasKeyIn(settings, p)} skipped={skipped.includes(p)} test={tests[p]} onNewPaste={() => onNewPaste(p)} onLater={() => onLater(p)} lang={lang} />
        ))}
      </div>
      {brake && (
        // the red line (features/governor): E +1 $ once · B a cheaper model · Esc — that provider's sentence again
        <Suspense fallback={null}>
          <BrakeSlot
            error={brake.error}
            onRetry={() => {
              const p = brake.p
              setBrake(null)
              void testOne(p)
            }}
            onCancel={() => {
              setBrake(null)
              // the note goes: the keyboard back to the test key (never the body)
              requestAnimationFrame(() => testKey.current?.focus())
            }}
          />
        </Suspense>
      )}
      <div className="aik-bench__foot">
        <button type="button" className="btn btn--sm" ref={testKey} disabled={!readyNow.length || testing} onClick={() => void sentence()} data-testid="test-sentence" title={readyNow.length && !testable.length ? t('features.ai.prov.check.sentenceModels') : undefined}>
          {t('features.ai.prov.check.sentence')}
        </button>
        <span className="label">{t('features.ai.prov.check.sentenceCost', { usd: fmtCost(0.0001, lang) })}</span>
      </div>
    </section>
  )
}

function BenchRow({ p, check, has, skipped, test, onNewPaste, onLater, lang }: { p: ProviderId; check?: CheckState; has: boolean; skipped: boolean; test?: { ms: number; receipt: Receipt | null; error?: string; note?: string }; onNewPaste: () => void; onLater: () => void; lang: Lang }) {
  const t = useT()
  const info = providerInfo(p)
  const [limitUrl, setLimitUrl] = useState<string>(info.limitUrl)
  useEffect(() => {
    let alive = true
    if (p === 'openrouter' && has) void keyLimitUrl(p).then((u) => alive && u && setLimitUrl(u))
    return () => {
      alive = false
    }
  }, [p, has])
  const again = useCallback(() => void runCheck(p), [p])
  const bad = check?.state === 'error'
  const help = bad ? helpFor(check!.code ?? 'unknown', p) : null
  const credit = check?.credit
  const word = check?.state === 'checking' ? t('features.ai.prov.check.checking') : check?.state === 'valid' ? (p === 'openrouter' ? t('features.ai.prov.check.connected') : t('features.ai.prov.check.valid')) : !has ? (skipped ? t('features.ai.prov.err.later') : t('features.ai.prov.state.none')) : t('features.ai.prov.check.untested')
  const keyFor = (k: HelpKey) => {
    switch (k) {
      case 'newPaste':
        return (
          <button key={k} type="button" className="btn btn--sm" onClick={onNewPaste} aria-keyshortcuts="N" data-testid="help-new-paste">
            {t('features.ai.prov.err.newPaste')} <span className="kbd">N</span>
          </button>
        )
      case 'keyPage':
        return (
          <a key={k} className="aik-link" href={info.keyUrl} target="_blank" rel="noreferrer noopener">
            {t('features.ai.prov.err.keyPage')} <ExternalLink size={11} aria-hidden />
          </a>
        )
      case 'topUp':
        return p === 'openrouter' ? (
          <a key={k} className="aik-link" href={PROVIDERS.openrouter.creditsUrl} target="_blank" rel="noreferrer noopener">
            {t('features.ai.prov.err.topUp')}
          </a>
        ) : null
      case 'limit':
        return (
          <a key={k} className="aik-link" href={limitUrl} target="_blank" rel="noreferrer noopener">
            {t('features.ai.prov.err.limit')}
          </a>
        )
      case 'retry':
        return (
          <button key={k} type="button" className="btn btn--sm" onClick={again}>
            {t('features.ai.prov.err.retry')}
          </button>
        )
      case 'help':
        return (
          <span key={k} className="aik-help">
            {t('features.ai.prov.err.help')} <HelpLink id="ai-unreachable" />
          </span>
        )
      case 'later':
        return (
          <button key={k} type="button" className="btn btn--sm btn--ghost" onClick={onLater}>
            {t('features.ai.prov.err.later')}
          </button>
        )
      default:
        return null
    }
  }
  return (
    <div
      className="aik-brow"
      data-bad={bad || undefined}
      data-testid={`bench-${p}`}
      data-state={check?.state ?? (has ? 'untested' : 'none')}
      onKeyDown={(e) => {
        if ((e.key === 'n' || e.key === 'N') && bad && help?.keys.includes('newPaste') && !(e.target instanceof HTMLInputElement)) {
          e.preventDefault()
          onNewPaste()
        }
      }}
    >
      <div className="aik-brow__who">
        <CodePlate p={p} />
        <b>{info.name}</b>
        <span className="aik-brow__sp" />
        {bad && help ? (
          <>
            <span className="lampcap" data-tone={help.tone} aria-hidden>
              {help.cap}
            </span>
            <span className="label aik-brow__bad">{check?.code === 'no_credit' ? t('features.ai.prov.state.noCredit') : t('features.ai.prov.state.refused')}</span>
          </>
        ) : (
          <>
            <span className={check?.state === 'valid' ? 'led led--ok' : check?.state === 'checking' ? 'led led--on aik-brow__blink' : 'led'} aria-hidden />
            <span className="label">{word}</span>
          </>
        )}
      </div>
      {check?.state === 'valid' && <p className="aik-brow__msg">{t('features.ai.prov.check.listed', { time: time(check.at, lang) })}</p>}
      {check?.state === 'valid' && p === 'openrouter' && credit && (
        <>
          <div className="aik-brow__gauge">
            <span>
              <span className="k">{t('features.ai.prov.check.keyLimit')}</span>
              <span className="v">{credit.limit === null ? t('features.ai.prov.check.none') : credit.reset ? t('features.ai.prov.check.perReset', { amount: fmtUsd(credit.limit, lang), reset: t(`features.ai.prov.check.reset.${credit.reset}`) }) : fmtUsd(credit.limit, lang)}</span>
            </span>
            {credit.remaining !== null && (
              <span>
                <span className="k">{t('features.ai.prov.check.credit')}</span>
                <span className="v">{fmtUsd(credit.remaining, lang)}</span>
              </span>
            )}
            <span>
              <span className="k">{t('features.ai.prov.check.used')}</span>
              <span className="v">{fmtUsd(credit.used, lang)}</span>
            </span>
            {credit.limit !== null && credit.limit > 0 && (
              <span className="aik-bar" aria-hidden>
                <i style={{ ['--v' as string]: `${Math.min(100, Math.round((credit.used / credit.limit) * 100))}%` }} />
              </span>
            )}
          </div>
          <p className="aik-brow__msg">
            {credit.free ? t('features.ai.prov.check.freeTier') : t('features.ai.prov.check.paidTier')} · {t('features.ai.prov.check.noCollect')}
          </p>
          {credit.limit === null && (
            <p className="aik-brow__warn" data-testid="no-limit">
              <span className="lampcap" data-tone="amber" aria-hidden>
                {t('features.ai.prov.check.noLimitCap')}
              </span>
              <span>{t('features.ai.prov.check.noLimit')}</span>
              <a className="aik-link" href={limitUrl} target="_blank" rel="noreferrer noopener">
                {t('features.ai.prov.key.limitLink')}
              </a>
            </p>
          )}
        </>
      )}
      {bad && help && (
        <div className="aik-ehelp" data-testid={`help-${check?.code}`}>
          <p>
            <Rich text={check?.code === 'no_credit' && p === 'openrouter' && has ? t('features.ai.prov.err.noCreditKept') : help.text} />
          </p>
          {help.causes.length > 0 && (
            <ul>
              {help.causes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          )}
          <div className="aik-ehelp__keys">{help.keys.map(keyFor)}</div>
        </div>
      )}
      {test && (
        <div className="aik-brow__test" data-testid={`test-${p}`}>
          {test.note ? <p className="aik-brow__msg" data-testid={`sentence-note-${p}`}>{test.note}</p> : test.error ? <p className="aik-brow__msg aik-brow__err">{test.error}</p> : <p className="aik-brow__msg">{t('features.ai.prov.check.sentenceOk', { ms: test.ms })}</p>}
          {test.receipt && <ReceiptLine receipt={test.receipt} testId={`test-receipt-${p}`} />}
        </div>
      )}
    </div>
  )
}
