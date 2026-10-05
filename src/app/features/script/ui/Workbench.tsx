/**
 * #/scripts/<id> — the workbench of one script: name and kind, the code editor (chips, completion,
 * inline errors), the run keys (Mod+Enter run · Mod+Shift+Enter dry run · Mod+. stop · Mod+E
 * evaluate the selection), below it the console / the live result of a query / the run log, and on
 * the side the visual query builder (queries) or the reference (scripts). Code saves as you type.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { create } from 'zustand'
import { ArrowLeft, Copy, FlaskConical, MoreHorizontal, Play, Square, Trash2 } from 'lucide-react'
import { useWorkspace } from '../../../store/store'
import { inTemplate, isEffectivelyTrashed } from '../../../store/selectors'
import type { ID } from '../../../store/types'
import { useCloud } from '../../../cloud'
import { Menu, useMenu } from '../../../ui/Menu'
import { shortcutLabel } from '../../../ui/controls'
import { useT } from '../../../i18n'
import { HelpLink } from '../../../help'
import { syntaxError } from '../lang'
import { CodeEditor, type EditorError, type RefCandidate } from '../editor/CodeEditor'
import { analyze } from '../editor/analyze'
import { Builder } from '../builder/Builder'
import { errorInfo, evaluateSelection, runScript, type RunResult } from '../runtime/run'
import { beginRun, endRun, notifyResult, stopScript, useActiveRuns } from '../runtime/active'
import { deleteScript, duplicateScript, openScripts, saveScript } from '../actions'
import type { ErrorInfo, LogLine } from '../runtime/types'
import { Console, ErrorLine, type Output } from './Console'
import { Runs } from './Runs'
import { Reference } from './Reference'
import { ResultTable } from './ResultTable'
import { errorMessage } from './errors'
import { pad2, rowsLabel } from './format'

/** The console of each script in this tab (survives leaving the page while a run goes on). */
const useOutputs = create<{ byId: Record<ID, Output> }>()(() => ({ byId: {} }))
const setOutput = (id: ID, out: Output) => useOutputs.setState((s) => ({ byId: { ...s.byId, [id]: out } }))

type Tab = 'result' | 'console' | 'runs'

/* ------------------------------------------------------------------ @ candidates, property names */

function refCandidates(query: string, selfId: ID, t: ReturnType<typeof useT>): RefCandidate[] {
  const s = useWorkspace.getState()
  const q = query.trim().toLowerCase()
  const score = (name: string) => {
    const n = name.toLowerCase()
    if (!q) return 1
    if (n.startsWith(q)) return 3
    if (n.split(/[\s/–-]+/).some((w) => w.startsWith(q))) return 2
    return n.includes(q) ? 1 : 0
  }
  const out: Array<RefCandidate & { score: number; rank: number }> = []
  for (const p of Object.values(s.pages)) {
    if (p.trashed || isEffectivelyTrashed(s.pages, p.id) || inTemplate(s.pages, p.id)) continue
    const title = p.title.trim()
    if (!title) continue
    const sc = score(title)
    if (!sc) continue
    const isDb = p.kind === 'database' && !!s.databases[p.id]
    const detail = isDb ? t('features.script.ed.ref.database') : p.databaseId ? t('features.script.ed.ref.row') : t('features.script.ed.ref.page')
    out.push({ label: title, kind: 'p', id: p.id, detail, score: sc, rank: isDb ? 0 : p.databaseId ? 2 : 1 })
  }
  for (const p of s.people) {
    const sc = score(p.name)
    if (sc) out.push({ label: p.name, kind: 'u', id: p.id, detail: t('features.script.ed.ref.person'), score: sc, rank: 1 })
  }
  for (const a of Object.values(s.agents ?? {})) {
    const sc = score(a.name)
    if (sc) out.push({ label: a.name, kind: 'a', id: a.id, detail: t('features.script.ed.ref.agent'), score: sc, rank: 3 })
  }
  for (const sc0 of Object.values(s.scripts ?? {})) {
    if (sc0.id === selfId) continue
    const sc = score(sc0.name)
    if (sc) out.push({ label: sc0.name, kind: 's', id: sc0.id, detail: t('features.script.ed.ref.script'), score: sc, rank: 3 })
  }
  return out
    .sort((a, b) => b.score - a.score || a.rank - b.rank || a.label.localeCompare(b.label))
    .slice(0, 12)
    .map(({ label, kind, id, detail }) => ({ label, kind, id, detail }))
}

/** A database by id, else by title (the code's db("…") / @Name). */
function dbByRef(dbId: string | null, dbName: string | null) {
  const s = useWorkspace.getState()
  if (dbId && s.databases[dbId]) return s.databases[dbId]
  if (!dbName) return null
  const n = dbName.trim().toLowerCase()
  const hit = Object.values(s.databases).find((d) => s.pages[d.id]?.title.trim().toLowerCase() === n && !s.pages[d.id]?.trashed)
  return hit ?? null
}

const propsOf = (dbId: string | null, dbName: string | null): string[] => dbByRef(dbId, dbName)?.properties.map((p) => p.name) ?? []

/* ------------------------------------------------------------------ the live result of a query */

function useDataTick(): number {
  const pages = useWorkspace((s) => s.pages)
  const dbs = useWorkspace((s) => s.databases)
  const [tick, setTick] = useState(0)
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    const timer = window.setTimeout(() => setTick((n) => n + 1), 400)
    return () => window.clearTimeout(timer)
  }, [pages, dbs])
  return tick
}

const onlyComments = (code: string) => !code.split('\n').some((l) => l.trim() && !/^\s*(#|\/\/)/.test(l))

function LiveResult({ id, name, code, broken, force, onResult }: { id: ID; name: string; code: string; broken: boolean; force: number; onResult: (r: { code: string; result: RunResult | null }) => void }) {
  const t = useT()
  const tick = useDataTick()
  const [state, setState] = useState<{ result: RunResult | null; running: boolean; code: string }>({ result: null, running: false, code: '' })
  const report = useRef(onResult)
  report.current = onResult
  useEffect(() => {
    if (broken || onlyComments(code)) {
      setState({ result: null, running: false, code })
      report.current({ code, result: null })
      return
    }
    const ctrl = new AbortController()
    const timer = window.setTimeout(async () => {
      setState((s) => ({ ...s, running: true }))
      const result = await runScript({ code, scriptId: id, name, mode: 'query', signal: ctrl.signal, limits: { ms: 15_000 } })
      if (ctrl.signal.aborted) return
      setState({ result, running: false, code })
      report.current({ code, result })
    }, 250)
    return () => {
      window.clearTimeout(timer)
      ctrl.abort()
    }
  }, [id, name, code, broken, tick, force])

  const r = state.result
  const fresh = state.code === code
  return (
    <section className="sc-live" aria-label={t('features.script.tester.title')} data-testid="sc-live" data-state={state.running ? 'running' : r?.status ?? 'idle'}>
      <div className="sc-live__head label">
        <span className={`led ${state.running ? 'led--on sc-led--live' : r?.error ? 'sc-led--err' : r ? 'led--ok' : ''}`} aria-hidden />
        <span>{t('features.script.tester.live')}</span>
        {r && !r.error && (r.table ? <span className="sc-live__count" data-testid="sc-live-count">{rowsLabel(t, r.table.total)}</span> : <span className="sc-live__count">{t('features.script.tester.value')}</span>)}
        {r && <span className="mono">{t('features.script.console.ms', { ms: r.ms })}</span>}
        <span className="sc-live__ro">{t('features.script.tester.readOnly')}</span>
      </div>
      <div className={`sc-live__body${fresh ? '' : ' is-stale'}`} aria-live="polite" aria-busy={state.running || undefined}>
        {!r && !state.running && <p className="sc-console__empty">{t('features.script.tester.empty')}</p>}
        {!r && state.running && <p className="sc-console__empty">{t('features.script.tester.running')}</p>}
        {r?.error && <ErrorLine error={r.error} />}
        {r && !r.error && r.table && r.table.total === 0 && (
          <p className="sc-live__none" data-testid="sc-live-none">
            {t('features.script.tester.none')}
          </p>
        )}
        {r && !r.error && r.table && r.table.total > 0 && <ResultTable table={r.table} />}
        {r && !r.error && !r.table && <pre className="sc-console__pre">= {r.text || 'null'}</pre>}
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ the name */

/** The script's name as a display title you can type into (wraps; Enter / Esc leave it). */
function NameField({ value, readOnly, label, onChange, onCommit, onCancel }: { value: string; readOnly: boolean; label: string; onChange: (v: string) => void; onCommit: () => void; onCancel: () => void }) {
  const ref = useRef<HTMLTextAreaElement | null>(null)
  const cancelled = useRef(false)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${el.scrollHeight}px`
  }, [value])
  return (
    <textarea
      ref={ref}
      className="sc-name"
      rows={1}
      value={value}
      aria-label={label}
      readOnly={readOnly}
      maxLength={80}
      spellCheck={false}
      onChange={(e) => onChange(e.target.value.replace(/\n/g, ' '))}
      onBlur={() => {
        if (cancelled.current) cancelled.current = false
        else onCommit()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          e.currentTarget.blur()
        }
        if (e.key === 'Escape') {
          cancelled.current = true
          onCancel()
          e.currentTarget.blur()
        }
      }}
    />
  )
}

/* ------------------------------------------------------------------ the workbench */

export function Workbench({ id }: { id: ID }) {
  const t = useT()
  const script = useWorkspace((s) => s.scripts?.[id])
  const order = useWorkspace((s) => s.scripts)
  const readOnly = useCloud((s) => s.readOnly)
  const active = useActiveRuns((s) => s.runs[id])
  const out = useOutputs((s) => s.byId[id] ?? null)
  const menu = useMenu()

  const [code, setCode] = useState(script?.code ?? '')
  const [name, setName] = useState(script?.name ?? '')
  const dirty = useRef(false)
  const codeRef = useRef(code)
  codeRef.current = code
  const kind = script?.kind ?? 'script'
  const [tab, setTab] = useState<Tab>(kind === 'query' ? 'result' : 'console')
  const [jump, setJump] = useState<{ line: number; col: number; n: number } | null>(null)
  const [runErr, setRunErr] = useState<{ code: string; info: ErrorInfo } | null>(null)
  const [liveErr, setLiveErr] = useState<{ code: string; info: ErrorInfo } | null>(null)
  const [force, setForce] = useState(0)
  const ta = useRef<HTMLTextAreaElement | null>(null)

  const index = useMemo(() => Object.values(order ?? {}).sort((a, b) => a.createdAt - b.createdAt).findIndex((s) => s.id === id), [order, id])

  /* -------------------------------------------------------------- saving */

  const save = useCallback(
    (patch: { code?: string; name?: string; kind?: 'script' | 'query' }) => {
      const cur = useWorkspace.getState().scripts?.[id]
      if (!cur || readOnly) return
      if ((patch.code === undefined || patch.code === cur.code) && (patch.name === undefined || patch.name === cur.name) && (patch.kind === undefined || patch.kind === cur.kind)) return
      saveScript({ ...cur, ...patch })
    },
    [id, readOnly],
  )

  const flush = useCallback(() => {
    if (!dirty.current) return
    dirty.current = false
    save({ code: codeRef.current })
  }, [save])

  // code saves a moment after typing stops (and when the page is left)
  useEffect(() => {
    if (!dirty.current) return
    const timer = window.setTimeout(flush, 500)
    return () => window.clearTimeout(timer)
  }, [code, flush])
  useEffect(() => () => flush(), [flush])

  // someone else (another tab, a team member, the builder of another pane) changed it: take it over
  useEffect(() => {
    if (script && !dirty.current && script.code !== codeRef.current) setCode(script.code)
  }, [script?.code]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (script) setName(script.name)
  }, [script?.name]) // eslint-disable-line react-hooks/exhaustive-deps

  const edit = (next: string) => {
    if (readOnly) return
    dirty.current = true
    setCode(next)
  }

  /* -------------------------------------------------------------- errors */

  const syntax = useMemo(() => syntaxError(code), [code])
  const shownErr: ErrorInfo | null = syntax ? errorInfo(syntax) : runErr && runErr.code === code ? runErr.info : kind === 'query' && liveErr && liveErr.code === code ? liveErr.info : null
  const editorError: EditorError | null = shownErr && shownErr.line !== null ? { start: shownErr.start, end: shownErr.end, line: shownErr.line, message: errorMessage(shownErr, t) } : null

  const analysis = useMemo(() => analyze(code), [code])
  const propNames = useMemo(() => new Set(analysis.dbRefs.flatMap((r) => propsOf(r.id, r.name))), [analysis])

  /* -------------------------------------------------------------- running */

  const start = async (mode: 'run' | 'dry') => {
    if (!script || active || kind === 'query') return
    flush()
    setTab('console')
    if (syntax) {
      setOutput(id, { mode, running: false, log: [], result: { status: 'error', value: null, plain: null, text: '', table: null, log: [], changes: [], effects: [], error: errorInfo(syntax), ms: 0, run: null } })
      return
    }
    const ctrl = beginRun(id, mode)
    if (!ctrl) return
    const lines: LogLine[] = []
    let pending = 0
    setOutput(id, { mode, running: true, log: [], result: null })
    try {
      const r = await runScript({
        code,
        scriptId: id,
        name: script.name,
        mode,
        signal: ctrl.signal,
        onLog: (l) => {
          lines.push(l)
          if (pending) return
          pending = window.requestAnimationFrame(() => {
            pending = 0
            const cur = useOutputs.getState().byId[id]
            if (cur?.running) setOutput(id, { ...cur, log: [...lines] })
          })
        },
      })
      if (pending) window.cancelAnimationFrame(pending)
      setOutput(id, { mode, running: false, log: r.log, result: r })
      setRunErr(r.error ? { code, info: r.error } : null)
      if (mode === 'run' && r.status === 'ok') notifyResult(script.name, mode, r)
    } finally {
      endRun(id, ctrl)
    }
  }

  const evaluate = async () => {
    const el = ta.current
    let from = el?.selectionStart ?? 0
    let to = el?.selectionEnd ?? 0
    if (from === to) {
      // nothing selected: the line the caret is on
      from = code.lastIndexOf('\n', from - 1) + 1
      const end = code.indexOf('\n', to)
      to = end < 0 ? code.length : end
    }
    if (!code.slice(from, to).trim()) return
    setTab('console')
    setOutput(id, { mode: 'eval', running: true, log: [], result: null })
    const r = await evaluateSelection(code, from, to, { scriptId: id, name: script?.name ?? '' })
    // its places belong to the evaluated piece, not to the script: no line links
    const error = r.error ? { ...r.error, line: null, col: null, start: null, end: null } : null
    setOutput(id, { mode: 'eval', running: false, log: r.log, result: { ...r, error } })
  }

  const onKey = (e: ReactKeyboardEvent) => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey || e.nativeEvent.isComposing) return
    const k = e.key.toLowerCase()
    if (e.key === 'Enter') {
      e.preventDefault()
      if (kind === 'query') setForce((n) => n + 1)
      else void start(e.shiftKey ? 'dry' : 'run')
    } else if (e.key === '.' && !e.shiftKey) {
      e.preventDefault()
      stopScript(id)
    } else if (k === 'e' && !e.shiftKey) {
      e.preventDefault()
      void evaluate()
    } else if (k === 's' && !e.shiftKey) {
      e.preventDefault()
      flush()
    }
  }

  const insertAtCaret = (text: string) => {
    const el = ta.current
    if (!el || readOnly) return
    el.focus()
    const a = el.selectionStart
    const b = el.selectionEnd
    const ok = typeof document.execCommand === 'function' && document.execCommand('insertText', false, text)
    if (!ok || el.value === code) {
      edit(code.slice(0, a) + text + code.slice(b))
      requestAnimationFrame(() => el.setSelectionRange(a + text.length, a + text.length))
    }
  }

  const onJump = (line: number, col: number) => setJump((j) => ({ line, col, n: (j?.n ?? 0) + 1 }))

  const commitName = () => {
    const n = name.replace(/\s+/g, ' ').trim()
    if (!n || !script) return setName(script?.name ?? '')
    save({ name: n })
  }

  if (!script)
    return (
      <div className="sc">
        <a className="sc-back" href="#/scripts">
          <ArrowLeft size={14} strokeWidth={1.8} aria-hidden /> {t('features.script.back')}
        </a>
        <p className="sc-note">{t('features.script.missing')}</p>
      </div>
    )

  const lines = code.split('\n').length
  const running = !!active

  return (
    <div className="sc sc--bench" onKeyDown={onKey} data-kind={kind}>
      <a className="sc-back" href="#/scripts">
        <ArrowLeft size={14} strokeWidth={1.8} aria-hidden /> {t('features.script.back')}
      </a>
      <header className="sc-head sc-head--bench">
        <div className="sc-head__meta label">
          <span className="sc-head__sec">§ SC-{pad2(index + 1)}</span>
          <span>{t(`features.script.kind.${kind}`)}</span>
          <span className="sc-head__rule" aria-hidden />
          <span className="mono" data-testid="sc-meta">
            {t(lines === 1 ? 'features.script.lines.one' : 'features.script.lines.other', { n: lines })}
          </span>
          <HelpLink id="one-script" />
        </div>
        <div className="sc-head__row">
          <NameField value={name} readOnly={readOnly} label={t('features.script.name')} onChange={setName} onCommit={commitName} onCancel={() => setName(script.name)} />
          <div className="sc-keys">
            <span className="sc-seg" role="group" aria-label={t('features.script.kind')}>
              {(['script', 'query'] as const).map((k) => (
                <button key={k} type="button" className={`sc-seg__b${kind === k ? ' is-on' : ''}`} aria-pressed={kind === k} disabled={readOnly} onClick={() => (save({ kind: k }), setTab(k === 'query' ? 'result' : 'console'))}>
                  {t(`features.script.kind.${k}`)}
                </button>
              ))}
            </span>
            {kind === 'script' &&
              (running ? (
                <button type="button" className="btn btn--sm" onClick={() => stopScript(id)} data-testid="sc-stop">
                  <Square size={12} strokeWidth={2} aria-hidden /> {t('features.script.stop')} <kbd className="kbd">{shortcutLabel('Mod+.')}</kbd>
                </button>
              ) : (
                <>
                  <button type="button" className="btn btn--sm" onClick={() => void start('dry')} data-testid="sc-dry">
                    <FlaskConical size={13} strokeWidth={1.8} aria-hidden /> {t('features.script.dry')} <kbd className="kbd">{shortcutLabel('Mod+Shift+↵')}</kbd>
                  </button>
                  <button type="button" className="btn btn--sm btn--primary" onClick={() => void start('run')} disabled={readOnly} data-testid="sc-run">
                    <Play size={12} strokeWidth={2} aria-hidden /> {t('features.script.run')} <kbd className="kbd">{shortcutLabel('Mod+↵')}</kbd>
                  </button>
                </>
              ))}
            <button type="button" className="icon-btn" onClick={menu.toggle} aria-label={t('features.script.more')} aria-haspopup="menu" aria-expanded={menu.open}>
              <MoreHorizontal size={16} strokeWidth={1.7} />
            </button>
            <Menu
              {...menu.props}
              placement="bottom-end"
              entries={[
                { label: t('features.script.evaluate'), hint: shortcutLabel('Mod+E'), onSelect: () => void evaluate() },
                ...(readOnly
                  ? []
                  : [
                      { label: t('features.script.duplicate'), icon: <Copy size={14} />, onSelect: () => duplicateScript(id) },
                      { kind: 'separator' as const },
                      { label: t('features.script.delete'), icon: <Trash2 size={14} />, danger: true, onSelect: () => (deleteScript(id), openScripts()) },
                    ]),
              ]}
            />
          </div>
        </div>
        {readOnly && <p className="sc-note">{t('features.script.readOnly')}</p>}
      </header>

      <div className="sc-bench">
        <div className="sc-bench__main">
          <CodeEditor
            value={code}
            onChange={edit}
            error={editorError}
            readOnly={readOnly}
            refs={(q) => refCandidates(q, id, t)}
            propsOf={propsOf}
            propNames={propNames}
            ariaLabel={t('features.script.code')}
            textareaRef={ta}
            jump={jump}
          />
          <div className="sc-tabs" role="tablist" aria-label={t('features.script.tab.console')}>
            {(kind === 'query' ? (['result', 'console', 'runs'] as const) : (['console', 'runs'] as const)).map((k) => (
              <button key={k} type="button" role="tab" id={`sc-tab-${k}`} aria-selected={tab === k} aria-controls={`sc-panel-${k}`} className={`sc-tabs__b${tab === k ? ' is-on' : ''}`} onClick={() => setTab(k)}>
                {t(`features.script.tab.${k}`)}
                {k === 'console' && out?.running && <span className="led led--on sc-led--live" aria-hidden />}
              </button>
            ))}
            <span className="sc-tabs__keys label" aria-hidden>
              {kind === 'script' ? (
                <>
                  <kbd className="kbd">{shortcutLabel('Mod+↵')}</kbd> {t('features.script.keys.run')} <kbd className="kbd">{shortcutLabel('Mod+Shift+↵')}</kbd> {t('features.script.keys.dry')} <kbd className="kbd">{shortcutLabel('Mod+.')}</kbd> {t('features.script.keys.stop')}{' '}
                </>
              ) : null}
              <kbd className="kbd">{shortcutLabel('Mod+E')}</kbd> {t('features.script.keys.eval')}
            </span>
          </div>
          <div className="sc-panel" role="tabpanel" id={`sc-panel-${tab}`} aria-labelledby={`sc-tab-${tab}`}>
            {kind === 'query' && (
              <div hidden={tab !== 'result'}>
                <LiveResult id={id} name={script.name} code={code} broken={!!syntax} force={force} onResult={({ code: c, result }) => setLiveErr(result?.error ? { code: c, info: result.error } : null)} />
              </div>
            )}
            {tab === 'console' && <Console out={out} onJump={onJump} />}
            {tab === 'runs' && <Runs scriptId={id} onJump={onJump} />}
          </div>
        </div>
        <aside className="sc-bench__side">{kind === 'query' ? <Builder code={code} onChange={edit} onEditAsText={() => ta.current?.focus()} /> : <Reference onInsert={insertAtCaret} />}</aside>
      </div>
    </div>
  )
}
