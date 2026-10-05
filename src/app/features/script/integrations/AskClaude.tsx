/**
 * "Ask Claude" — on top of the query builder (queries) and the reference (scripts) next to a script:
 * describe what it should do, Claude drafts the code (integrations/ask.ts: parsed before it is shown;
 * a query is also tried read-only for its row count), the person reads the draft and uses it — the
 * code is replaced, with Undo — or discards it. Nothing runs and nothing is saved before that.
 */
import { useRef, useState, type KeyboardEvent } from 'react'
import { Check, CornerDownLeft, Square, X } from 'lucide-react'
import { toast } from '../../../store/ui'
import { shortcutLabel } from '../../../ui/controls'
import { useT } from '../../../i18n'
import { draftWithClaude } from './ask'
import { runQueryForTool } from './tools'
import './integrations.css'

type State =
  | { phase: 'idle' }
  | { phase: 'asking' }
  | { phase: 'draft'; code: string; rows: number | null; note: string | null }
  | { phase: 'invalid'; code: string; error: string }
  | { phase: 'error'; message: string }

/** "@[Tasks](p:abc)" → "@Tasks" (the draft is shown as text). */
const readable = (code: string) => code.replace(/@\[((?:[^\]\\]|\\.)*)\]\((?:p|u|a|s):[\w-]+\)/g, (_m, label: string) => `@${label.replace(/\\(.)/g, '$1')}`)

export function AskClaude({ kind, code, readOnly, onAccept }: { kind: 'script' | 'query'; code: string; readOnly: boolean; onAccept: (code: string) => void }) {
  const t = useT()
  const [task, setTask] = useState('')
  const [state, setState] = useState<State>({ phase: 'idle' })
  const ctrl = useRef<AbortController | null>(null)
  const area = useRef<HTMLTextAreaElement | null>(null)

  const ask = async () => {
    if (!task.trim() || state.phase === 'asking' || readOnly) return
    const ac = new AbortController()
    ctrl.current = ac
    setState({ phase: 'asking' })
    try {
      const d = await draftWithClaude({ task, kind, code, signal: ac.signal })
      if (ac.signal.aborted) return
      if (d.error) return setState({ phase: 'invalid', code: d.code, error: d.error })
      let rows: number | null = null
      let note: string | null = null
      if (kind === 'query') {
        // tried read-only (nothing can change): its count, or why it would not run
        const out = await runQueryForTool(d.code, { maxRows: 1, signal: ac.signal })
        if (ac.signal.aborted) return
        if (out.ok) rows = out.count ?? null
        else note = out.error
      }
      setState({ phase: 'draft', code: d.code, rows, note })
    } catch (e) {
      if (ac.signal.aborted) return setState({ phase: 'idle' })
      setState({ phase: 'error', message: e instanceof Error ? e.message : String(e) })
    } finally {
      if (ctrl.current === ac) ctrl.current = null
    }
  }

  const stop = () => {
    ctrl.current?.abort()
    setState({ phase: 'idle' })
  }

  const accept = () => {
    if (state.phase !== 'draft') return
    const before = code
    onAccept(state.code)
    setState({ phase: 'idle' })
    setTask('')
    toast({ kind: 'success', message: t('features.script.int.ask.used'), action: { label: t('common.undo'), run: () => onAccept(before) } })
  }

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      e.stopPropagation()
      void ask()
    } else if (e.key === 'Escape' && state.phase === 'asking') {
      e.preventDefault()
      e.stopPropagation()
      stop()
    }
  }

  const lines = state.phase === 'draft' || state.phase === 'invalid' ? state.code.trimEnd().split('\n').length : 0
  return (
    <section className="sc-ask" aria-label={t('features.script.int.ask.title')} data-testid="sc-ask" data-phase={state.phase}>
      <h2 className="sc-pane__head label sc-ask__head">
        <span className={`led${state.phase === 'asking' ? ' led--on sc-led--live' : state.phase === 'draft' ? ' led--ok' : state.phase === 'invalid' || state.phase === 'error' ? ' sc-led--err' : ''}`} aria-hidden />
        {t('features.script.int.ask.title')}
        <span className="sc-ask__state">{state.phase === 'asking' ? t('features.script.int.ask.writing') : state.phase === 'draft' ? t('features.script.int.ask.parsed') : ''}</span>
      </h2>
      <div className="sc-ask__body">
        <textarea
          ref={area}
          className="sc-ask__input"
          rows={2}
          value={task}
          disabled={readOnly}
          placeholder={t(kind === 'query' ? 'features.script.int.ask.placeholder.query' : 'features.script.int.ask.placeholder.script')}
          aria-label={t(kind === 'query' ? 'features.script.int.ask.label.query' : 'features.script.int.ask.label.script')}
          onChange={(e) => setTask(e.target.value)}
          onKeyDown={onKey}
        />
        <div className="sc-ask__keys">
          <span className="sc-ask__note">{t('features.script.int.ask.privacy')}</span>
          {state.phase === 'asking' ? (
            <button type="button" className="btn btn--sm" onClick={stop}>
              <Square size={11} strokeWidth={2} aria-hidden /> {t('features.script.stop')}
            </button>
          ) : (
            <button type="button" className="btn btn--sm btn--ink" onClick={() => void ask()} disabled={!task.trim() || readOnly} data-testid="sc-ask-go">
              {t('features.script.int.ask.go')} <kbd className="kbd">{shortcutLabel('Mod+↵')}</kbd>
            </button>
          )}
        </div>

        {state.phase === 'error' && (
          <p className="sc-ask__err" role="alert">
            {state.message}
          </p>
        )}
        {state.phase === 'invalid' && (
          <div className="sc-ask__draft" data-invalid>
            <p className="sc-ask__err" role="alert">
              {t('features.script.int.ask.invalid', { error: state.error })}
            </p>
            <pre className="sc-ask__code">{readable(state.code)}</pre>
            <div className="sc-ask__keys">
              <span className="sc-ask__meta label">{t(lines === 1 ? 'features.script.lines.one' : 'features.script.lines.other', { n: lines })}</span>
              <button type="button" className="btn btn--sm btn--ghost" onClick={() => setState({ phase: 'idle' })}>
                <X size={12} strokeWidth={1.8} aria-hidden /> {t('features.script.int.ask.discard')}
              </button>
            </div>
          </div>
        )}
        {state.phase === 'draft' && (
          <div className="sc-ask__draft" data-testid="sc-ask-draft">
            <pre className="sc-ask__code">{readable(state.code)}</pre>
            {state.note && <p className="sc-ask__warn">{state.note}</p>}
            <div className="sc-ask__keys">
              <span className="sc-ask__meta label">
                {t(lines === 1 ? 'features.script.lines.one' : 'features.script.lines.other', { n: lines })}
                {state.rows !== null && ` · ${t(state.rows === 1 ? 'features.script.int.ask.rows.one' : 'features.script.int.ask.rows.other', { n: state.rows })}`}
              </span>
              <button type="button" className="btn btn--sm btn--ghost" onClick={() => setState({ phase: 'idle' })}>
                <X size={12} strokeWidth={1.8} aria-hidden /> {t('features.script.int.ask.discard')}
              </button>
              <button type="button" className="btn btn--sm btn--primary" onClick={accept} data-testid="sc-ask-use" autoFocus>
                <Check size={12} strokeWidth={2} aria-hidden /> {t('features.script.int.ask.use')} <CornerDownLeft size={11} strokeWidth={1.8} aria-hidden />
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
