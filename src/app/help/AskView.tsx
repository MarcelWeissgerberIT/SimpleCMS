/**
 * "Ask the help": a question → the AI (your key) answers from the best-matching help articles only and
 * links the ones it used. Without a key: a hint and the matching articles instead. With "Belegt?" on (Settings › AI,
 * slice SJ — off by default) the form says before the first send that Jev checks the answer against the articles,
 * and one line under the answer says what Jev found ("Ask more thoroughly (R)" asks again on the deep role).
 */
import { Suspense, useEffect, useMemo, useRef, type KeyboardEvent } from 'react'
import { create } from 'zustand'
import { ArrowRight, Square } from 'lucide-react'
import { useLang, useT } from '../i18n'
import { useWorkspace } from '../store/store'
import { AINeedsSetup, BrakeSlot, RouteChip, SupportedLine, aiStatus, deeperRoute, offersAI, destinationOf, isAIConfigured, isRouteKey, runVerify, useVerifyOn, verifyOn, type Route, type RouteChipHandle, type VerifyResult } from '../features'
import { shortcutLabel } from '../ui/controls'
import { askHelp, linkCitations } from './ask'
import { LIBRARY } from './content'
import { Doc } from './Doc'
import type { HelpArticle, HelpLang } from './library'
import { parseBlocks } from './markdown'
import { articlesForQuestion } from './search'
import { useHelp } from './state'
import { ArticleRow, useDocNav } from './views'

type Phase = 'idle' | 'running' | 'done' | 'error' | 'nokey' | 'nomatch'

interface AskState {
  phase: Phase
  /** the question the answer belongs to */
  asked: string
  answer: string
  error: string
  sources: HelpArticle[]
  /** the last `askRun` request handled */
  handled: number
  /** the route chip: the model for the next question only (null: the rules decide) */
  chip: Route | null
  /** "Belegt?": what Jev found about the answer (null: not asked — off, or no answer yet) */
  verify: VerifyResult | 'checking' | null
  /** the route the shown answer was asked on (the chip then, or "Ask more thoroughly"'s deep role; null: the rules) */
  via: Route | null
  /** the question refused at the Regler's red line (nothing was sent): the brake note's error */
  brake: unknown
}

/** The ask session outlives the view: open a cited article, come back, the answer is still there. */
const useAsk = create<AskState>()(() => ({ phase: 'idle', asked: '', answer: '', error: '', sources: [], handled: 0, chip: null, verify: null, via: null, brake: null }))
let abort: AbortController | null = null

/** The article last open in the panel: a question asked from it is probably about it. */
function lastArticle(): string | undefined {
  const { stack, index } = useHelp.getState()
  for (let i = index; i >= 0; i--) {
    const loc = stack[i]
    if (loc.kind === 'article') return loc.id
  }
  return undefined
}

async function ask(lang: HelpLang, q = useHelp.getState().question, route?: Route | null): Promise<void> {
  const text = q.trim()
  if (!text) return
  abort?.abort()
  const sources = articlesForQuestion(LIBRARY, lang, text, 6, lastArticle())
  const via = route ?? useAsk.getState().chip
  useAsk.setState({ asked: text, answer: '', error: '', sources, verify: null, via, brake: null })
  // the gate's answer for help questions (a key for a route the rules allow); demo answers stay out of the help
  const st = aiStatus('help.ask')
  if (!offersAI(st) || !isAIConfigured()) return useAsk.setState({ phase: 'nokey' })
  if (!sources.length) return useAsk.setState({ phase: 'nomatch' })
  const ctrl = new AbortController()
  abort = ctrl
  useAsk.setState({ phase: 'running' })
  try {
    const final = await askHelp({ question: text, articles: sources, lang, signal: ctrl.signal, route: via, onToken: (d) => useAsk.setState((s) => ({ answer: s.answer + d })) })
    if (ctrl.signal.aborted) return
    useAsk.setState({ answer: final, phase: 'done' })
    // "Belegt?" (off by default): Jev checks the answer against the articles it was built from, as sent
    if (verifyOn() && final.trim()) {
      useAsk.setState({ verify: 'checking' })
      const res = await runVerify({ question: text, sources: sources.map((a) => ({ title: a.title, text: `${a.summary ? `${a.summary}\n` : ''}${a.source}` })), answer: final, refs: [], source: 'help:ask', signal: ctrl.signal, applied: { people: true, transcript: true, visible: true } })
      if (!ctrl.signal.aborted && useAsk.getState().answer === final) useAsk.setState({ verify: res })
    }
  } catch (e) {
    if (ctrl.signal.aborted) return
    useAsk.setState({ error: e instanceof Error ? e.message : String(e), phase: 'error', brake: (e as { code?: unknown } | null)?.code === 'budget' ? e : null })
  }
}

function stop() {
  abort?.abort()
  abort = null
  useAsk.setState({ phase: 'done' })
}

export function AskView() {
  const t = useT()
  const lang = useLang()
  const nav = useDocNav()
  const question = useHelp((s) => s.question)
  const askRun = useHelp((s) => s.askRun)
  const model = useWorkspace((s) => s.settings.aiModel)
  const { phase, asked, answer, error, sources, chip, verify, via, brake } = useAsk()
  const checks = useVerifyOn()
  const chipRef = useRef<RouteChipHandle | null>(null)
  const fieldRef = useRef<HTMLTextAreaElement | null>(null)

  // "Ask the help: …" from the search results (or a link elsewhere) sends the question right away
  useEffect(() => {
    if (askRun <= useAsk.getState().handled) return
    useAsk.setState({ handled: askRun })
    void ask(lang)
  }, [askRun, lang])

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Alt+M: the route picker (the field keeps its text)
    if (isRouteKey(e.nativeEvent)) {
      e.preventDefault()
      chipRef.current?.open()
      return
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      if (phase !== 'running') void ask(lang)
    }
  }

  const blocks = useMemo(() => (answer.trim() ? parseBlocks(linkCitations(answer, sources)) : []), [answer, sources])
  // the model the shown answer comes from: the route it was asked on (the chip then, or the deep role R asked); before a
  // question the chip, else the rules — re-read when this device's model changes
  const shown = phase === 'idle' ? chip : via
  const dest = useMemo(() => destinationOf('help.ask', { route: shown }), [shown, model])
  const modelLabel = dest.label
  // "Ask more thoroughly": the deep role of the provider that answered (null: none deeper — an answer from the deep role
  // itself offers no key: R asks once more, not again and again)
  const deeper = useMemo(() => (verify && verify !== 'checking' && verify.support === 'unsupported' ? deeperRoute('help.ask', via) : null), [verify, via, model])

  return (
    <div className="help-ask">
      <h3 className="help-art__title" tabIndex={-1} data-help-heading>
        {t('help.ask.title')}
      </h3>
      <p className="help-art__summary">{t('help.ask.lead')}</p>
      <form
        className="help-ask__form"
        onSubmit={(e) => {
          e.preventDefault()
          if (phase !== 'running') void ask(lang)
        }}
      >
        <label className="label help-ask__label" htmlFor="help-ask-q">
          {t('help.ask.label')}
        </label>
        <textarea
          ref={fieldRef}
          id="help-ask-q"
          className="input help-ask__field"
          data-help-autofocus=""
          rows={3}
          value={question}
          placeholder={t('help.ask.placeholder')}
          onChange={(e) => useHelp.setState({ question: e.target.value })}
          onKeyDown={onKeyDown}
        />
        <div className="help-ask__bar">
          <span className="label help-ask__hint">
            <span className="kbd">↵</span> {t('help.ask.go')} · <span className="kbd">{shortcutLabel('Shift')}↵</span> {t('help.ask.newLine')}
          </span>
          <RouteChip
            handle={chipRef}
            purpose="help.ask"
            chip={chip}
            onChip={(r) => useAsk.setState({ chip: r })}
            sources={[]}
            reads={t('features.ai.prov.chip.reads.help')}
            disabled={phase === 'running'}
            onClosed={() => requestAnimationFrame(() => fieldRef.current?.focus({ preventScroll: true }))}
            testId="help-route-chip"
          />
          {phase === 'running' ? (
            <button type="button" className="btn btn--sm" onClick={stop}>
              <Square size={11} aria-hidden /> {t('help.ask.stop')}
            </button>
          ) : (
            <button type="submit" className="btn btn--primary btn--sm" disabled={!question.trim()}>
              {t('help.ask.go')} <ArrowRight size={13} aria-hidden />
            </button>
          )}
        </div>
        {/* "Belegt?" on: said before the first send — Jev reads the question, the articles and the answer */}
        {checks && (
          <p className="jev-goes help-ask__jev" data-testid="help-jev-goes">
            {t('features.ai.jev.verify.goes')}
          </p>
        )}
      </form>

      {phase === 'idle' && !asked && (
        <div className="help-ask__examples">
          <p className="label">{t('help.ask.examples')}</p>
          {(['help.ask.ex.1', 'help.ask.ex.2', 'help.ask.ex.3'] as const).map((k) => (
            <button
              key={k}
              type="button"
              className="help-ask__example"
              onClick={() => {
                useHelp.setState({ question: t(k) })
                void ask(lang, t(k))
              }}
            >
              {t(k)}
            </button>
          ))}
        </div>
      )}

      {phase === 'nokey' && (
        <div className="help-ask__nokey help-ask__nokey--card">
          <AINeedsSetup purpose="help.ask" testId="help-ask-needs" />
          <p>{t('help.ask.noKey.body')}</p>
        </div>
      )}

      {phase === 'nomatch' && <p className="help-empty">{t('help.ask.noMatch')}</p>}

      {(phase === 'running' || phase === 'done' || phase === 'error') && (
        <section className="help-ask__out" aria-live="polite" aria-busy={phase === 'running'}>
          <p className="label help-ask__head">
            <span className={`led${phase === 'running' ? ' led--on help-blink' : phase === 'error' ? '' : ' led--ok'}`} aria-hidden />
            {t('help.ask.model', { model: modelLabel })}
            {checks && ` ${t('features.ai.jev.verify.goes')}`}
            {phase === 'running' && <span className="help-ask__reading"> · {t('help.ask.reading', { n: sources.length })}</span>}
          </p>
          {phase === 'error' && brake ? (
            // the red line (features/governor): E +1 $ once · B a cheaper model · Esc — the question is asked again
            <Suspense fallback={<p className="help-ask__error">{error}</p>}>
              <BrakeSlot
                error={brake}
                onRetry={() => void ask(lang, asked, via)}
                onCancel={() => {
                  useAsk.setState({ phase: 'idle', brake: null })
                  fieldRef.current?.focus({ preventScroll: true })
                }}
              />
            </Suspense>
          ) : phase === 'error' ? (
            <p className="help-ask__error" role="alert">
              {error}
            </p>
          ) : blocks.length ? (
            <>
              <Doc blocks={blocks} nav={nav} className="help-doc--answer" />
              {phase === 'done' && verify && <SupportedLine result={verify} onDeeper={deeper ? () => void ask(lang, asked, deeper) : null} />}
            </>
          ) : (
            <p className="help-ask__wait" aria-hidden>
              …
            </p>
          )}
        </section>
      )}

      {sources.length > 0 && phase !== 'idle' && phase !== 'nomatch' && (
        <section className="help-related" aria-labelledby="help-sources-h">
          <h4 className="label help-related__label" id="help-sources-h">
            {phase === 'nokey' ? t('help.related') : t('help.ask.sources', { company: dest.company })}
          </h4>
          <ul className="help-list">
            {sources.map((a) => (
              <li key={a.id}>
                <ArticleRow a={a} summary={phase === 'nokey'} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
