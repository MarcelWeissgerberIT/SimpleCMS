import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Command } from 'cmdk'
import { ArrowRight, Copy, CornerDownLeft, FilePlus2, KeyRound, ListPlus, Square } from 'lucide-react'
import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import { selectBreadcrumbs } from '../../store/selectors'
import { isAIConfigured, runAI } from '../../features'
import { markdownToDoc, ReadOnlyDoc } from '../../editor'
import { PageIcon } from '../../ui/PageIcon'
import { shortcutLabel, ALT } from '../../ui/controls'
import { useT } from '../../i18n'
import type { ID, Page } from '../../store/types'
import { buildCommands, type Command as Cmd } from '../lib/commands'
import { createPageAndOpen, currentPageId, goToPage } from '../lib/actions'
import { buildIndex, search, type Range } from './search'
import './palette.css'

export function CommandPalette() {
  const open = useUI((s) => s.paletteOpen)
  return open ? <Palette /> : null
}

type Mode = 'find' | 'run' | 'ask'

function Palette() {
  const t = useT()
  const initial = useUI.getState().paletteQuery
  const [q, setQ] = useState(initial)
  const [value, setValue] = useState('')
  const pages = useWorkspace((s) => s.pages)
  const recentIds = useWorkspace((s) => s.recent)
  const lang = useWorkspace((s) => s.settings.language)
  const close = useUI((s) => s.closePalette)
  const prevFocus = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null)
  const pageId = currentPageId()

  const mode: Mode = q.startsWith('>') ? 'run' : q.startsWith('?') ? 'ask' : 'find'
  const term = mode === 'find' ? q.trim() : q.slice(1).trim()

  const fuse = useMemo(() => buildIndex(pages), [pages])
  const hits = useMemo(() => (mode === 'find' && term ? search(fuse, term) : []), [fuse, mode, term])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const commands = useMemo(() => buildCommands(t, pageId), [t, pageId, pages, lang])
  const cmdHits = useMemo(() => {
    if (mode === 'ask') return []
    if (!term) return mode === 'run' ? commands : commands.filter((c) => CORE.includes(c.id))
    const n = term.toLowerCase()
    return commands.filter((c) => c.label.toLowerCase().includes(n) || c.keywords?.toLowerCase().includes(n) || c.id.includes(n))
  }, [commands, mode, term])
  const recent = useMemo(
    () => recentIds.map((id) => pages[id]).filter((p): p is Page => !!p && !p.trashed && p.id !== pageId).slice(0, 6),
    [recentIds, pages, pageId],
  )

  const finish = (restoreFocus = false) => {
    close()
    if (restoreFocus) requestAnimationFrame(() => prevFocus.current?.focus?.({ preventScroll: true }))
  }
  const openPageItem = (id: ID, pane = false) => {
    finish()
    if (pane) useUI.getState().openPane(id)
    else goToPage(id)
  }
  const runCmd = (c: Cmd) => {
    if (c.id === 'ask-ai') {
      setQ('? ')
      return
    }
    finish()
    c.run()
  }

  const path = (p: Page) =>
    selectBreadcrumbs(pages, p.id)
      .slice(0, -1)
      .map((x) => x.title.trim() || t('common.untitled'))
      .join(' / ')

  return (
    <div className="pal-scrim" onMouseDown={(e) => e.target === e.currentTarget && finish(true)}>
      <div
        className="pal"
        role="dialog"
        aria-modal="true"
        aria-label={t('shell.palette.label')}
        onKeyDownCapture={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            if (mode !== 'find' && q.length > 1) setQ('')
            else finish(true)
            return
          }
          if (e.key === 'Enter' && e.altKey && value.startsWith('page:')) {
            e.preventDefault()
            e.stopPropagation()
            openPageItem(value.slice(5), true)
          }
          if (e.key === 'Backspace' && mode !== 'find' && q.length === 1) {
            e.preventDefault()
            setQ('')
          }
        }}
      >
        <Command shouldFilter={false} loop value={value} onValueChange={setValue} label={t('shell.palette.label')}>
          <div className="pal-input">
            <span className="pal-mode" data-mode={mode}>
              {mode === 'find' ? t('shell.palette.find') : mode === 'run' ? t('shell.palette.run') : t('shell.palette.ask')}
            </span>
            <Command.Input
              autoFocus
              value={mode === 'find' ? q : q.slice(1).replace(/^ /, '')}
              onValueChange={(v) => setQ(mode === 'find' ? v : (mode === 'run' ? '>' : '?') + v)}
              placeholder={mode === 'find' ? t('shell.palette.placeholder') : mode === 'run' ? t('shell.palette.placeholderRun') : t('shell.palette.placeholderAsk')}
              className="pal-input__field"
            />
            <span className="kbd">Esc</span>
          </div>
          {mode === 'ask' ? (
            <AskPanel question={term} pageId={pageId} onDone={() => finish()} />
          ) : (
            <Command.List className="pal-list">
              <Command.Empty className="pal-empty">
                <span className="label">{t('shell.palette.noSignal')}</span>
                <span>{t('shell.palette.empty', { q: term })}</span>
              </Command.Empty>
              {mode === 'find' && !term && recent.length > 0 && (
                <Command.Group heading={<GroupHead label={t('shell.palette.recent')} n={recent.length} />}>
                  {recent.map((p) => (
                    <PageItem key={p.id} page={p} path={path(p)} onSelect={() => openPageItem(p.id)} />
                  ))}
                </Command.Group>
              )}
              {mode === 'find' && term && (
                <Command.Group heading={<GroupHead label={t('shell.palette.pages')} n={hits.length} />}>
                  {hits.map((h) => (
                    <PageItem key={h.page.id} page={h.page} path={path(h.page)} titleRanges={h.titleRanges} snippet={h.snippet} onSelect={() => openPageItem(h.page.id)} />
                  ))}
                  <Command.Item value={`create:${term}`} className="pal-item" onSelect={() => (finish(), createPageAndOpen(null, term))}>
                    <span className="pal-item__icon">
                      <FilePlus2 size={16} />
                    </span>
                    <span className="pal-item__main">
                      <span className="pal-item__title">{t('shell.palette.createPage', { q: term })}</span>
                    </span>
                  </Command.Item>
                </Command.Group>
              )}
              {cmdHits.length > 0 && (
                <Command.Group heading={<GroupHead label={t('shell.palette.commands')} n={cmdHits.length} />}>
                  {cmdHits.map((c) => (
                    <Command.Item key={c.id} value={`cmd:${c.id}`} className="pal-item" onSelect={() => runCmd(c)}>
                      <span className="pal-item__icon">
                        <c.icon size={16} strokeWidth={1.7} />
                      </span>
                      <span className="pal-item__main">
                        <span className="pal-item__title">{c.label}</span>
                      </span>
                      {c.shortcut && <span className="kbd pal-item__kbd">{shortcutLabel(c.shortcut)}</span>}
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
            </Command.List>
          )}
          <div className="pal-foot">
            <span>
              <span className="kbd">↑</span>
              <span className="kbd">↓</span> {t('shell.palette.navigate')}
            </span>
            <span>
              <span className="kbd">↵</span> {mode === 'ask' ? t('shell.palette.askGo') : t('shell.palette.open')}
            </span>
            {mode === 'find' && (
              <span className="pal-foot__opt">
                <span className="kbd">{ALT}↵</span> {t('shell.palette.pane')}
              </span>
            )}
            <span className="pal-foot__spacer" />
            <button type="button" className="pal-foot__mode" data-on={mode === 'run' || undefined} onClick={() => setQ(mode === 'run' ? '' : '>')}>
              <span className="kbd">&gt;</span> {t('shell.palette.commandsHint')}
            </button>
            <button type="button" className="pal-foot__mode" data-on={mode === 'ask' || undefined} onClick={() => setQ(mode === 'ask' ? '' : '?')}>
              <span className="kbd">?</span> {t('shell.palette.askHint')}
            </button>
          </div>
        </Command>
      </div>
    </div>
  )
}

const CORE = ['new-page', 'new-database', 'journal', 'templates', 'import', 'ask-ai', 'graph', 'theme', 'focus', 'present', 'settings']

function GroupHead({ label, n }: { label: string; n: number }) {
  return (
    <span className="pal-group">
      <span>{label}</span>
      <span className="pal-group__rule" />
      <span className="pal-group__n">{String(n).padStart(2, '0')}</span>
    </span>
  )
}

function PageItem({ page, path, titleRanges, snippet, onSelect }: { page: Page; path: string; titleRanges?: Range[]; snippet?: { text: string; ranges: Range[] } | null; onSelect: () => void }) {
  const t = useT()
  const title = page.title.trim() || t('common.untitled')
  return (
    <Command.Item value={`page:${page.id}`} className="pal-item pal-item--page" onSelect={onSelect}>
      <span className="pal-item__icon">
        <PageIcon icon={page.icon} kind={page.kind} size={18} />
      </span>
      <span className="pal-item__main">
        <span className="pal-item__line">
          <span className="pal-item__title" data-untitled={!page.title.trim() || undefined}>
            {titleRanges?.length ? highlight(title, titleRanges) : title}
          </span>
          {path && <span className="pal-item__path">{path}</span>}
        </span>
        {snippet && <span className="pal-item__snippet">{highlight(snippet.text, snippet.ranges)}</span>}
      </span>
      <CornerDownLeft size={13} className="pal-item__enter" />
    </Command.Item>
  )
}

function highlight(text: string, ranges: Range[]): ReactNode {
  if (!ranges.length) return text
  const out: ReactNode[] = []
  let pos = 0
  ranges.forEach(([a, b], i) => {
    if (a < pos) return
    if (a > pos) out.push(<Fragment key={`t${i}`}>{text.slice(pos, a)}</Fragment>)
    out.push(<mark key={`m${i}`}>{text.slice(a, b + 1)}</mark>)
    pos = b + 1
  })
  if (pos < text.length) out.push(<Fragment key="end">{text.slice(pos)}</Fragment>)
  return out
}

/* ------------------------------------------------------------------ */
/* Ask AI (Claude, BYOK) — answers about the current page               */
/* ------------------------------------------------------------------ */

function AskPanel({ question, pageId, onDone }: { question: string; pageId: ID | null; onDone: () => void }) {
  const t = useT()
  const model = useWorkspace((s) => s.settings.aiModel)
  const page = useWorkspace((s) => (pageId ? s.pages[pageId] : undefined))
  const configured = useWorkspace((s) => !!s.settings.aiApiKey) && isAIConfigured()
  const [answer, setAnswer] = useState('')
  const [state, setState] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [error, setError] = useState('')
  const abort = useRef<AbortController | null>(null)

  useEffect(() => () => abort.current?.abort(), [])

  const ask = async () => {
    if (!question || state === 'running') return
    abort.current?.abort()
    const ctrl = new AbortController()
    abort.current = ctrl
    setAnswer('')
    setError('')
    setState('running')
    try {
      const context = page ? `${page.title}\n\n${(page.plain ?? '').slice(0, 12000)}` : undefined
      const final = await runAI({
        action: 'custom',
        input: page?.plain?.slice(0, 12000) ?? '',
        instruction: question,
        context,
        signal: ctrl.signal,
        // runAI streams deltas, not the text so far
        onToken: (delta) => setAnswer((prev) => prev + delta),
      })
      if (ctrl.signal.aborted) return
      setAnswer(final || '')
      setState('done')
    } catch (e) {
      if (ctrl.signal.aborted) return
      setError(e instanceof Error ? e.message : String(e))
      setState('error')
    }
  }

  const append = () => {
    if (!page || !answer) return
    const doc = markdownToDoc(answer)
    const cur = page.content?.content ?? []
    useWorkspace.getState().setContent(page.id, { type: 'doc', content: [...cur, ...(doc.content ?? [])] }, 'ai')
    useUI.getState().toast({ message: t('shell.ask.appended'), kind: 'success' })
    onDone()
  }

  const toNewPage = () => {
    const id = useWorkspace.getState().createPage({ title: question.slice(0, 80), content: markdownToDoc(answer) })
    onDone()
    goToPage(id)
  }

  if (!configured)
    return (
      <div className="ask">
        <div className="ask__locked">
          <KeyRound size={18} strokeWidth={1.6} />
          <div>
            <strong>{t('shell.ask.noKeyTitle')}</strong>
            <p>{t('shell.ask.noKeyBody')}</p>
          </div>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => {
              onDone()
              useUI.getState().openModal({ type: 'settings', tab: 'ai' })
            }}
          >
            {t('shell.ask.addKey')}
          </button>
        </div>
      </div>
    )

  return (
    <div className="ask">
      <Command.List className="pal-list pal-list--ask">
        <Command.Item value="ask:go" className="pal-item" onSelect={ask} disabled={!question}>
          <span className="pal-item__icon">
            <ArrowRight size={16} />
          </span>
          <span className="pal-item__main">
            <span className="pal-item__title">{question ? t('shell.ask.go', { q: question }) : t('shell.ask.prompt')}</span>
            <span className="pal-item__path">{page ? t('shell.ask.context', { title: page.title.trim() || t('common.untitled') }) : t('shell.ask.noContext')}</span>
          </span>
        </Command.Item>
      </Command.List>
      {(state !== 'idle' || answer) && (
        <div className="ask__out" aria-live="polite">
          <div className="ask__head label">
            <span className={`led${state === 'running' ? ' led--on ask__blink' : state === 'error' ? '' : ' led--ok'}`} />
            CLAUDE · {model.replace('claude-', '').replace(/-(\d)-(\d)/, ' $1.$2').toUpperCase()}
            {state === 'running' && (
              <button type="button" className="ask__stop" onClick={() => (abort.current?.abort(), setState('done'))}>
                <Square size={10} /> {t('shell.ask.stop')}
              </button>
            )}
          </div>
          {state === 'error' ? <p className="ask__error">{error}</p> : <AskAnswer markdown={answer} />}
          {state === 'done' && answer && (
            <div className="ask__actions">
              {page && !page.settings.locked && page.kind === 'page' && (
                <button type="button" className="btn btn--sm btn--ink" onClick={append}>
                  <ListPlus size={13} /> {t('shell.ask.append')}
                </button>
              )}
              <button type="button" className="btn btn--sm" onClick={toNewPage}>
                <FilePlus2 size={13} /> {t('shell.ask.newPage')}
              </button>
              <button
                type="button"
                className="btn btn--sm btn--ghost"
                onClick={() => {
                  void navigator.clipboard?.writeText(answer)
                  useUI.getState().toast({ message: t('common.copied'), kind: 'success' })
                }}
              >
                <Copy size={13} /> {t('shell.ask.copy')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** Claude answers in Markdown — render it like a page (throttled while it streams). */
function AskAnswer({ markdown }: { markdown: string }) {
  const shown = useThrottled(markdown, 140)
  const doc = useMemo(() => (shown.trim() ? markdownToDoc(shown) : null), [shown])
  if (!doc) return <div className="ask__answer ask__answer--wait">…</div>
  return (
    <div className="ask__answer">
      <ReadOnlyDoc content={doc} className="doc--small ask__doc" />
    </div>
  )
}

function useThrottled<T>(value: T, ms: number): T {
  const [out, setOut] = useState(value)
  const last = useRef(0)
  useEffect(() => {
    const wait = Math.max(0, last.current + ms - Date.now())
    const id = window.setTimeout(() => {
      last.current = Date.now()
      setOut(value)
    }, wait)
    return () => window.clearTimeout(id)
  }, [value, ms])
  return out
}
