import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Command } from 'cmdk'
import { ArrowRight, CircleHelp, Copy, CornerDownLeft, FilePlus2, KeyRound, LayoutTemplate, ListPlus, Square } from 'lucide-react'
import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import { inTemplate, isEffectivelyTrashed, selectBreadcrumbs } from '../../store/selectors'
import { CodewordChip, isAIConfigured, McpSkippedNote, runAI, templateName, templateRoots, type McpCall } from '../../features'
import { memoryFor, MemoryNote, noteUse, type MemoryUse } from '../../features'
import { webImagesOf, withoutWebImages } from '../../features'
import { markdownToDoc, readableContent, ReadOnlyDoc } from '../../editor'
import { PageIcon } from '../../ui/PageIcon'
import { restoreFocus as restoreFocusTo } from '../../ui/focus'
import { shortcutLabel, ALT } from '../../ui/controls'
import { useT } from '../../i18n'
import type { ID, Page } from '../../store/types'
import { buildCommands, type Command as Cmd } from '../lib/commands'
import { contextPageId, createPageAndOpen, goToPage } from '../lib/actions'
import { useMediaQuery } from '../lib/hooks'
import { buildIndex, search, type Range, type SearchHit } from './search'
import { useReadOnly } from '../cloud/state'
import { openHelp, useHelpHits } from '../../help'
import './palette.css'

export function CommandPalette() {
  const open = useUI((s) => s.paletteOpen)
  return open ? <Palette /> : null
}

type Mode = 'find' | 'run' | 'ask'

function Palette() {
  const t = useT()
  const readOnly = useReadOnly()
  const initial = useUI.getState().paletteQuery
  const [q, setQ] = useState(initial)
  const [value, setValue] = useState('')
  const pages = useWorkspace((s) => s.pages)
  const recentIds = useWorkspace((s) => s.recent)
  const lang = useWorkspace((s) => s.settings.language)
  const close = useUI((s) => s.closePalette)
  const prevFocus = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null)
  const pageId = contextPageId()
  const narrow = useMediaQuery('(max-width: 560px)')

  const mode: Mode = q.startsWith('>') ? 'run' : q.startsWith('?') ? 'ask' : 'find'
  const term = mode === 'find' ? q.trim() : q.slice(1).trim()

  const fuse = useMemo(() => buildIndex(pages), [pages])
  const hits = useMemo(() => (mode === 'find' && term ? search(fuse, term) : []), [fuse, mode, term])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const commands = useMemo(() => buildCommands(t, pageId), [t, pageId, pages, lang, readOnly])
  const cmdHits = useMemo(() => {
    if (mode === 'ask') return []
    // database commands ("Mails: Sync now") only by typing: the empty lists stay short
    if (!term) return mode === 'run' ? commands.filter((c) => c.group !== 'database') : commands.filter((c) => CORE.includes(c.id))
    return rankCommands(commands, term)
  }, [commands, mode, term])
  const titleHits = useMemo(() => hits.filter((h) => h.field === 'title'), [hits])
  const contentHits = useMemo(() => hits.filter((h) => h.field === 'content'), [hits])
  /*
   * Enter runs the first row, so the order is the answer to "what did they mean?":
   * a command named like the query (3+ letters) beats a page that merely shares a word;
   * pages whose title matches beat commands found only via keywords; body-text hits and
   * "Create page" never shadow a command.
   */
  // (a database's commands start with its name: "Projects" still opens the page, not "Projects: New entry")
  const commandsFirst = cmdHits.length > 0 && (titleHits.length === 0 || (term.length >= 3 && cmdHits.some((c) => c.group !== 'database' && labelStarts(c.label, term))))
  const recent = useMemo(
    () => recentIds.map((id) => pages[id]).filter((p): p is Page => !!p && !isEffectivelyTrashed(pages, p.id) && !inTemplate(pages, p.id) && p.id !== pageId).slice(0, 6),
    [recentIds, pages, pageId],
  )
  // own templates (and customised built-ins) whose name matches: open the gallery on them
  const roots = useMemo(() => templateRoots(pages), [pages])
  const templateHits = useMemo(() => {
    const n = term.toLowerCase()
    if (mode !== 'find' || n.length < 2) return []
    return roots.filter((p) => templateName(p).toLowerCase().includes(n)).slice(0, 4)
  }, [roots, mode, term])
  // articles of the manual (help area) — after the workspace's own pages
  const helpHits = useHelpHits(mode === 'find' ? term : '', lang)

  const finish = (restoreFocus = false) => {
    close()
    if (!restoreFocus) return
    requestAnimationFrame(() => {
      // quick hands (Esc, ⌘K) open the palette again before this frame: its field keeps the focus
      const now = document.activeElement
      if (now && now !== document.body && now.isConnected) return
      restoreFocusTo(prevFocus.current)
    })
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

  // Escape belongs to the topmost layer: listen on window (capture), ahead of any menu or
  // popover left open underneath (they listen on document) — the palette closes first
  const onEscape = useRef(() => {})
  onEscape.current = () => {
    if (mode !== 'find' && q.length > 1) setQ('')
    else finish(true)
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing) return
      e.preventDefault()
      e.stopPropagation()
      onEscape.current()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  const path = (p: Page) =>
    selectBreadcrumbs(pages, p.id)
      .slice(0, -1)
      .map((x) => x.title.trim() || t('common.untitled'))
      .join(' / ')

  const commandGroup = cmdHits.length > 0 && (
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
  )
  const pageHit = (h: SearchHit) => (
    <PageItem key={h.page.id} page={h.page} path={path(h.page)} titleRanges={h.titleRanges} snippet={h.snippet} onSelect={() => openPageItem(h.page.id)} />
  )

  return (
    <div className="pal-scrim" onMouseDown={(e) => e.target === e.currentTarget && finish(true)}>
      <div
        className="pal"
        role="dialog"
        aria-modal="true"
        aria-label={t('shell.palette.label')}
        onKeyDownCapture={(e) => {
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
              placeholder={mode === 'find' ? t(narrow ? 'shell.palette.placeholderShort' : 'shell.palette.placeholder') : mode === 'run' ? t('shell.palette.placeholderRun') : t('shell.palette.placeholderAsk')}
              className="pal-input__field"
            />
            {mode === 'ask' && <CodewordChip text={term} />}
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
              {mode === 'find' && term ? (
                <>
                  {commandsFirst && commandGroup}
                  {titleHits.length > 0 && (
                    <Command.Group heading={<GroupHead label={t('shell.palette.pages')} n={titleHits.length} />}>
                      {titleHits.map(pageHit)}
                    </Command.Group>
                  )}
                  {!commandsFirst && commandGroup}
                  {templateHits.length > 0 && (
                    <Command.Group heading={<GroupHead label={t('features.tpl.title')} n={templateHits.length} />}>
                      {templateHits.map((p) => (
                        <Command.Item
                          key={p.id}
                          value={`tpl:${p.id}`}
                          className="pal-item"
                          onSelect={() => (finish(), useUI.getState().openModal({ type: 'templates', parentId: null, select: p.id }))}
                        >
                          <span className="pal-item__icon">
                            <LayoutTemplate size={16} strokeWidth={1.7} />
                          </span>
                          <span className="pal-item__main">
                            <span className="pal-item__line">
                              <span className="pal-item__title">{templateName(p)}</span>
                              <span className="pal-item__path">{t('features.tpl.title')}</span>
                            </span>
                          </span>
                          <CornerDownLeft size={13} className="pal-item__enter" />
                        </Command.Item>
                      ))}
                    </Command.Group>
                  )}
                  {contentHits.length > 0 && (
                    <Command.Group heading={<GroupHead label={t('shell.palette.inContent')} n={contentHits.length} />}>
                      {contentHits.map(pageHit)}
                    </Command.Group>
                  )}
                  {helpHits.length > 0 && (
                    <Command.Group heading={<GroupHead label={t('help.palette.group')} n={helpHits.length} />}>
                      {helpHits.map((h) => (
                        <Command.Item key={h.id} value={`help:${h.id}`} className="pal-item" onSelect={() => (finish(), openHelp(h.id))}>
                          <span className="pal-item__icon">
                            <CircleHelp size={16} strokeWidth={1.7} />
                          </span>
                          <span className="pal-item__main">
                            <span className="pal-item__line">
                              <span className="pal-item__title">{h.title}</span>
                              <span className="pal-item__path">{t('help.palette.path', { num: h.num })}</span>
                            </span>
                          </span>
                          <CornerDownLeft size={13} className="pal-item__enter" />
                        </Command.Item>
                      ))}
                    </Command.Group>
                  )}
                  {!readOnly && (
                    <Command.Group className="pal-create">
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
                </>
              ) : (
                commandGroup
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

/** Command matches, best first: label prefix › label word › keyword word › anywhere. */
function rankCommands(commands: Cmd[], term: string): Cmd[] {
  const n = term.toLowerCase()
  const rank = (c: Cmd) => {
    const label = c.label.toLowerCase()
    const keywords = c.keywords?.toLowerCase() ?? ''
    if (label.startsWith(n)) return 0
    if (wordStarts(label, n)) return 1
    if (wordStarts(keywords, n)) return 2
    if (label.includes(n)) return 3
    if (keywords.includes(n) || (c.group !== 'database' && c.id.includes(n))) return 4
    return -1
  }
  return commands
    .map((c, i) => ({ c, i, r: rank(c) }))
    .filter((x) => x.r >= 0)
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.c)
}

const wordStarts = (text: string, n: string) => text.split(/[\s()&,/…-]+/).some((w) => w.startsWith(n))
const labelStarts = (label: string, term: string) => label.toLowerCase().startsWith(term.toLowerCase())

const CORE = ['new-page', 'new-database', 'quick-note', 'journal', 'agenda', 'templates', 'import', 'ask-ai', 'graph', 'theme', 'focus', 'present', 'settings']

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
  const readOnly = useReadOnly()
  const model = useWorkspace((s) => s.settings.aiModel)
  const page = useWorkspace((s) => (pageId ? s.pages[pageId] : undefined))
  const configured = useWorkspace((s) => !!s.settings.aiApiKey) && isAIConfigured()
  const [answer, setAnswer] = useState('')
  const [state, setState] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [error, setError] = useState('')
  /** MCP activity of the answer (a server addressed by codeword that stayed out is noted) */
  const [mcpCalls, setMcpCalls] = useState<McpCall[]>([])
  /** the One memory that went along with the question (null: not in use) */
  const [memory, setMemory] = useState<MemoryUse | null>(null)
  const abort = useRef<AbortController | null>(null)

  useEffect(() => () => abort.current?.abort(), [])

  const ask = async () => {
    if (!question || state === 'running') return
    abort.current?.abort()
    const ctrl = new AbortController()
    abort.current = ctrl
    setAnswer('')
    setMcpCalls([])
    setError('')
    setState('running')
    // the One memory: the memories that fit the question go along
    const mem = memoryFor(question)
    setMemory(mem.use)
    let answered = ''
    try {
      // only what the page's context marks allow ("Reads: …" — whole page, marked blocks or nothing)
      const read = page ? readableContent(page.id) : null
      const text = read && read.mode !== 'none' ? read.markdown.slice(0, 12000) : ''
      const context = page ? (text ? `${page.title}\n\n${text}` : page.title) : undefined
      const final = await runAI({
        action: 'custom',
        input: text,
        instruction: question,
        context,
        signal: ctrl.signal,
        // runAI streams deltas, not the text so far
        onToken: (delta) => setAnswer((prev) => prev + delta),
        onMcp: (calls) => !ctrl.signal.aborted && setMcpCalls(calls),
        memory: mem.block,
      })
      answered = final || ''
      if (ctrl.signal.aborted) return
      setAnswer(final || '')
      setState('done')
    } catch (e) {
      if (ctrl.signal.aborted) return
      setError(e instanceof Error ? e.message : String(e))
      setState('error')
    } finally {
      noteUse(answered, mem.use, { task: question, where: { kind: 'palette' }, pageId: page?.id ?? null, result: t(answered ? 'features.memory.result.answer' : ctrl.signal.aborted ? 'features.memory.result.stopped' : 'features.memory.result.failed') })
    }
  }

  const append = () => {
    if (!page || !answer) return
    const doc = markdownToDoc(withoutWebImages(answer, webImagesOf(page.content)))
    const cur = page.content?.content ?? []
    useWorkspace.getState().setContent(page.id, { type: 'doc', content: [...cur, ...(doc.content ?? [])] }, 'ai')
    useUI.getState().toast({ message: t('shell.ask.appended'), kind: 'success' })
    onDone()
  }

  const toNewPage = () => {
    const id = useWorkspace.getState().createPage({ title: question.slice(0, 80), content: markdownToDoc(withoutWebImages(answer)) })
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
            {memory && <MemoryNote use={memory} onOpen={onDone} />}
            {state === 'running' && (
              <button type="button" className="ask__stop" onClick={() => (abort.current?.abort(), setState('done'))}>
                <Square size={10} /> {t('shell.ask.stop')}
              </button>
            )}
          </div>
          <McpSkippedNote calls={mcpCalls} />
          {state === 'error' ? <p className="ask__error">{error}</p> : <AskAnswer markdown={answer} />}
          {state === 'done' && answer && (
            <div className="ask__actions">
              {page && !page.settings.locked && page.kind === 'page' && !readOnly && (
                <button type="button" className="btn btn--sm btn--ink" onClick={append}>
                  <ListPlus size={13} /> {t('shell.ask.append')}
                </button>
              )}
              {!readOnly && (
                <button type="button" className="btn btn--sm" onClick={toNewPage}>
                  <FilePlus2 size={13} /> {t('shell.ask.newPage')}
                </button>
              )}
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

/**
 * Claude answers in Markdown — render it like a page (throttled while it streams). The answer follows
 * the open page and MCP results: a web image in it would load the moment it shows, so it is a link.
 */
function AskAnswer({ markdown }: { markdown: string }) {
  const shown = useThrottled(markdown, 140)
  const doc = useMemo(() => (shown.trim() ? markdownToDoc(withoutWebImages(shown)) : null), [shown])
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
