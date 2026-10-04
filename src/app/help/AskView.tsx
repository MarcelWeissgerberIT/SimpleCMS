/**
 * "Ask the help": a question → Claude (your key) answers from the best-matching help articles only and
 * links the ones it used. Without a key: a hint and the matching articles instead.
 */
import { useEffect, useMemo, type KeyboardEvent } from 'react'
import { create } from 'zustand'
import { ArrowRight, KeyRound, Square } from 'lucide-react'
import { useLang, useT } from '../i18n'
import { useWorkspace } from '../store/store'
import { useUI } from '../store/ui'
import { isAIConfigured } from '../features'
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
}

/** The ask session outlives the view: open a cited article, come back, the answer is still there. */
const useAsk = create<AskState>()(() => ({ phase: 'idle', asked: '', answer: '', error: '', sources: [], handled: 0 }))
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

async function ask(lang: HelpLang, q = useHelp.getState().question): Promise<void> {
  const text = q.trim()
  if (!text) return
  abort?.abort()
  const sources = articlesForQuestion(LIBRARY, lang, text, 6, lastArticle())
  useAsk.setState({ asked: text, answer: '', error: '', sources })
  if (!isAIConfigured()) return useAsk.setState({ phase: 'nokey' })
  if (!sources.length) return useAsk.setState({ phase: 'nomatch' })
  const ctrl = new AbortController()
  abort = ctrl
  useAsk.setState({ phase: 'running' })
  try {
    const final = await askHelp({ question: text, articles: sources, lang, signal: ctrl.signal, onToken: (d) => useAsk.setState((s) => ({ answer: s.answer + d })) })
    if (ctrl.signal.aborted) return
    useAsk.setState({ answer: final, phase: 'done' })
  } catch (e) {
    if (ctrl.signal.aborted) return
    useAsk.setState({ error: e instanceof Error ? e.message : String(e), phase: 'error' })
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
  const { phase, asked, answer, error, sources } = useAsk()

  // "Ask the help: …" from the search results (or a link elsewhere) sends the question right away
  useEffect(() => {
    if (askRun <= useAsk.getState().handled) return
    useAsk.setState({ handled: askRun })
    void ask(lang)
  }, [askRun, lang])

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      if (phase !== 'running') void ask(lang)
    }
  }

  const blocks = useMemo(() => (answer.trim() ? parseBlocks(linkCitations(answer, sources)) : []), [answer, sources])
  const modelLabel = model.replace('claude-', '').replace(/-(\d)-(\d)/, ' $1.$2').toUpperCase()

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
        <div className="help-ask__nokey" role="note">
          <div className="help-ask__nokeyHead">
            <KeyRound size={15} strokeWidth={1.7} aria-hidden />
            <strong>{t('help.ask.noKey.title')}</strong>
          </div>
          <p>{t('help.ask.noKey.body')}</p>
          <button type="button" className="btn btn--sm btn--ink" onClick={() => useUI.getState().openModal({ type: 'settings', tab: 'ai' })}>
            {t('help.ask.noKey.open')}
          </button>
        </div>
      )}

      {phase === 'nomatch' && <p className="help-empty">{t('help.ask.noMatch')}</p>}

      {(phase === 'running' || phase === 'done' || phase === 'error') && (
        <section className="help-ask__out" aria-live="polite" aria-busy={phase === 'running'}>
          <p className="label help-ask__head">
            <span className={`led${phase === 'running' ? ' led--on help-blink' : phase === 'error' ? '' : ' led--ok'}`} aria-hidden />
            {t('help.ask.model', { model: modelLabel })}
            {phase === 'running' && <span className="help-ask__reading"> · {t('help.ask.reading', { n: sources.length })}</span>}
          </p>
          {phase === 'error' ? (
            <p className="help-ask__error" role="alert">
              {error}
            </p>
          ) : blocks.length ? (
            <Doc blocks={blocks} nav={nav} className="help-doc--answer" />
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
            {phase === 'nokey' ? t('help.related') : t('help.ask.sources')}
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
