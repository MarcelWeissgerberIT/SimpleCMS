import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Command } from 'cmdk'
import { ArrowRight, AtSign, CalendarClock, CircleHelp, Copy, CornerDownLeft, FilePlus2, FileText, KeyRound, LayoutTemplate, ListPlus, Lock, Square, Table2, ToggleLeft, Filter as FilterIcon } from 'lucide-react'
import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import { selectBreadcrumbs } from '../../store/selectors'
import { CodewordChip, isAIConfigured, McpSkippedNote, runAI, templateName, templateRoots, type McpCall } from '../../features'
import { memoryFor, MemoryNote, noteUse, type MemoryUse } from '../../features'
import { claudeDoc, webImagesOf } from '../../features'
import { MediaToPage, type MediaItem } from '../../features'
import { readableContent, ReadOnlyDoc } from '../../editor'
import { TypeIcon } from '../../database'
import { PageIcon } from '../../ui/PageIcon'
import { handFocusOver, restoreFocus as restoreFocusTo } from '../../ui/focus'
import { shortcutLabel, ALT } from '../../ui/controls'
import { useT } from '../../i18n'
import type { ID, Page } from '../../store/types'
import { buildCommands, type Command as Cmd } from '../lib/commands'
import { contextPageId, createPageAndOpen, goToPage } from '../lib/actions'
import { useMediaQuery } from '../lib/hooks'
import { frequentPages, recentPages, useVisits } from '../lib/visits'
import type { Range, SearchHit } from './search'
import { useFind } from './useFind'
import { matchedValues, type ShownValue } from './filters'
import type { Suggestion } from './suggest'
import { Chips } from './Chips'
import { useReadOnly } from '../cloud/state'
import { openHelp, useHelpHits } from '../../help'
import { useTour } from '../tour/state'
import './palette.css'

export function CommandPalette() {
  const open = useUI((s) => s.paletteOpen)
  return open ? <Palette /> : null
}

/** Rows of the empty field's RECENT and FREQUENT groups. */
const EMPTY_ROWS = 6

function Palette() {
  const t = useT()
  const readOnly = useReadOnly()
  const find = useFind(useUI.getState().paletteQuery)
  const { q, mode, chips, setQuery, parsed, filtering, text, hits, total, sugs, fx, env } = find
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const pages = useWorkspace((s) => s.pages)
  const recentIds = useWorkspace((s) => s.recent)
  const visits = useVisits((s) => s.map)
  const lang = useWorkspace((s) => s.settings.language)
  const close = useUI((s) => s.closePalette)
  const prevFocus = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null)
  const pageId = contextPageId()
  const narrow = useMediaQuery('(max-width: 560px)')

  /** what the commands are ranked on: the input as typed ("Projects: New entry" stays a command) */
  const raw = mode === 'find' ? q.trim() : q.slice(1).trim()
  /** a query to show results for (words, filters, or a filter being typed) */
  const asking = mode === 'find' && (!!raw || chips.length > 0)

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const commands = useMemo(() => buildCommands(t, pageId), [t, pageId, pages, lang, readOnly])
  const tourDone = useTour((s) => !!s.memory.done)
  const cmdHits = useMemo(() => {
    if (mode === 'ask' || filtering) return []
    // database commands ("Mails: Sync now") only by typing: the empty lists stay short
    if (!raw) return mode === 'run' ? commands.filter((c) => c.group !== 'database') : rootCommands(commands, tourDone)
    return rankCommands(commands, raw)
  }, [commands, mode, raw, tourDone, filtering])
  const titleHits = useMemo(() => hits.filter((h) => h.field === 'title'), [hits])
  const contentHits = useMemo(() => hits.filter((h) => h.field === 'content'), [hits])
  /*
   * Enter runs the first row, so the order is the answer to "what did they mean?":
   * a command named like the query (3+ letters) beats a page that merely shares a word;
   * pages whose title matches beat commands found only via keywords; body-text hits and
   * "Create page" never shadow a command.
   */
  // (a database's commands start with its name: "Projects" still opens the page, not "Projects: New entry")
  const commandsFirst = cmdHits.length > 0 && (titleHits.length === 0 || (raw.length >= 3 && cmdHits.some((c) => c.group !== 'database' && labelStarts(c.label, raw))))
  // the empty field: where you were (RECENT), then what this device opens most (FREQUENT) — no page twice
  const recent = useMemo(() => recentPages(pages, recentIds, EMPTY_ROWS, new Set(pageId ? [pageId] : [])), [recentIds, pages, pageId])
  const frequent = useMemo(() => frequentPages(pages, visits, Date.now(), EMPTY_ROWS, new Set([...(pageId ? [pageId] : []), ...recent.map((p) => p.id)])), [visits, pages, pageId, recent])
  // own templates (and customised built-ins) whose name matches: open the gallery on them
  const roots = useMemo(() => templateRoots(pages), [pages])
  const templateHits = useMemo(() => {
    const n = text.toLowerCase()
    if (mode !== 'find' || filtering || n.length < 2) return []
    return roots.filter((p) => templateName(p).toLowerCase().includes(n)).slice(0, 4)
  }, [roots, mode, text, filtering])
  // articles of the manual (help area) — after the workspace's own pages
  const helpHits = useHelpHits(mode === 'find' && !filtering ? text : '', lang)
  const topSugs = sugs.place === 'top' ? sugs.items : []
  const bottomSugs = sugs.place === 'bottom' ? sugs.items : []
  const sugById = useMemo(() => new Map(sugs.items.map((s) => [`sug:${s.id}`, s])), [sugs])
  // the values a filtered row was found by, under its title (only for the rows shown)
  const shown = useMemo(() => {
    const out = new Map<ID, ShownValue[]>()
    if (!filtering) return out
    for (const h of hits) out.set(h.page.id, matchedValues(fx, find.active, h.page, env, t))
    return out
  }, [hits, filtering, fx, env, t, find.active])

  // chips changed: the first row is the one Enter opens again (cmdk re-selects only when the field's text changes)
  useLayoutEffect(() => {
    if (!find.rev) return
    const first = listRef.current?.querySelector<HTMLElement>('[cmdk-item]:not([aria-disabled="true"])')
    if (first) setValue(first.getAttribute('data-value') ?? '')
  }, [find.rev])

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
      setQuery('? ')
      return
    }
    // a dialog the command opens gives focus back where it was before ⌘K
    handFocusOver(prevFocus.current)
    finish()
    c.run()
  }
  const focusInput = () => requestAnimationFrame(() => inputRef.current?.focus())
  const acceptSug = (s: Suggestion) => {
    find.accept(s)
    focusInput()
  }

  // Escape belongs to the topmost layer: listen on window (capture), ahead of any menu or
  // popover left open underneath (they listen on document) — the palette closes first
  const onEscape = useRef(() => {})
  onEscape.current = () => {
    if (mode !== 'find' && q.length > 1) setQuery('')
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
  const dbName = (p: Page) => (p.databaseId ? pages[p.databaseId]?.title.trim() || t('common.untitled') : undefined)

  const cmdItem = (c: Cmd) => (
    <Command.Item key={c.id} value={`cmd:${c.id}`} className="pal-item" onSelect={() => runCmd(c)}>
      <span className="pal-item__icon">
        <c.icon size={16} strokeWidth={1.7} />
      </span>
      <span className="pal-item__main">
        <span className="pal-item__title">{c.label}</span>
      </span>
      {c.shortcut && <span className="kbd pal-item__kbd">{shortcutLabel(c.shortcut)}</span>}
    </Command.Item>
  )
  // the lists without a query come in groups (create · go to · Claude · this page · workspace · getting started);
  // a query ranks every match in one list
  const commandGroup =
    cmdHits.length > 0 &&
    (raw ? (
      <Command.Group heading={<GroupHead label={t('shell.palette.commands')} n={cmdHits.length} />}>{cmdHits.map(cmdItem)}</Command.Group>
    ) : (
      GROUP_ORDER.map((g) => {
        const list = cmdHits.filter((c) => c.group === g)
        return list.length ? (
          <Command.Group key={g} heading={<GroupHead label={t(`shell.palette.group.${g}`)} n={list.length} />}>
            {list.map(cmdItem)}
          </Command.Group>
        ) : null
      })
    ))
  const pageHit = (h: SearchHit) => (
    <PageItem
      key={h.page.id}
      page={h.page}
      path={path(h.page)}
      titleRanges={h.titleRanges}
      snippet={h.snippet}
      props={shown.get(h.page.id)}
      db={filtering ? dbName(h.page) : undefined}
      onSelect={() => openPageItem(h.page.id)}
    />
  )
  const sugGroup = (list: Suggestion[], heading: string) =>
    list.length > 0 && (
      <Command.Group heading={<GroupHead label={heading} n={list.length} />}>
        {list.map((s) => (
          <SuggestionItem key={s.id} s={s} onSelect={() => acceptSug(s)} />
        ))}
      </Command.Group>
    )
  // filtered rows without words: the newest first, the rest is counted
  const more = total !== null && total > titleHits.length ? total - titleHits.length : 0
  const resultsLabel = filtering && !text ? t('shell.palette.results') : t('shell.palette.pages')

  return (
    <div className="pal-scrim" onMouseDown={(e) => e.target === e.currentTarget && finish(true)}>
      <div
        className="pal"
        role="dialog"
        aria-modal="true"
        aria-label={t('shell.palette.label')}
        onKeyDownCapture={(e) => {
          if (e.nativeEvent.isComposing) return
          const inField = document.activeElement === inputRef.current
          if (e.key === 'Enter' && e.altKey && inField && value.startsWith('page:')) {
            e.preventDefault()
            e.stopPropagation()
            openPageItem(value.slice(5), true)
            return
          }
          if (e.key === 'Backspace' && mode !== 'find' && q.length === 1) {
            e.preventDefault()
            setQuery('')
            return
          }
          if (mode !== 'find' || !inField) return
          const field = inputRef.current
          // an empty field: Backspace takes the last chip back off
          if (e.key === 'Backspace' && !e.altKey && !e.metaKey && !e.ctrlKey && q === '' && chips.length && field && field.selectionStart === 0 && field.selectionEnd === 0) {
            e.preventDefault()
            find.popChip()
            return
          }
          // Tab takes the selected suggestion (or the first)
          if (e.key === 'Tab' && !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey && sugs.items.length) {
            e.preventDefault()
            acceptSug(sugById.get(value) ?? sugs.items[0])
          }
        }}
      >
        <Command
          shouldFilter={false}
          loop
          value={value}
          onValueChange={setValue}
          label={t('shell.palette.label')}
          onKeyDown={(e) => {
            // Enter on a focused key ("How filters work", > / ?) is that key's — cmdk would run the selected row
            const b = e.target
            if (e.key !== 'Enter' || e.defaultPrevented || e.nativeEvent.isComposing || !(b instanceof HTMLButtonElement) || b.disabled) return
            e.preventDefault()
            b.click()
          }}
        >
          <div className="pal-input" data-chips={chips.length ? true : undefined}>
            <span className="pal-mode" data-mode={mode}>
              {mode === 'find' ? t('shell.palette.find') : mode === 'run' ? t('shell.palette.run') : t('shell.palette.ask')}
            </span>
            <Chips
              chips={chips}
              fx={fx}
              env={env}
              onRemove={(i) => {
                find.removeChip(i)
                focusInput()
              }}
            />
            <Command.Input
              ref={inputRef}
              autoFocus
              value={mode === 'find' ? q : q.slice(1).replace(/^ /, '')}
              onValueChange={(v) => setQuery(mode === 'find' ? v : (mode === 'run' ? '>' : '?') + v)}
              placeholder={chips.length ? '' : mode === 'find' ? t(narrow ? 'shell.palette.placeholderShort' : 'shell.palette.placeholder') : mode === 'run' ? t('shell.palette.placeholderRun') : t('shell.palette.placeholderAsk')}
              className="pal-input__field"
            />
            {mode === 'ask' && <CodewordChip text={raw} />}
            <span className="kbd">Esc</span>
          </div>
          {mode === 'find' && sugs.hint && (
            <div className="pal-hint" role="note" aria-live="polite">
              <span className="pal-hint__text">{sugs.hint}</span>
              <button type="button" className="pal-hint__help" onClick={() => (finish(), openHelp('command-palette'))}>
                <CircleHelp size={12} aria-hidden />
                {t('shell.palette.filterHelp')}
              </button>
            </div>
          )}
          {mode === 'ask' ? (
            <AskPanel question={raw} pageId={pageId} onDone={() => finish()} />
          ) : (
            <Command.List className="pal-list" ref={listRef}>
              <Command.Empty className="pal-empty">
                <span className="label">{t('shell.palette.noSignal')}</span>
                <span>{filtering ? t('shell.palette.noFilterMatch') : t('shell.palette.empty', { q: raw })}</span>
              </Command.Empty>
              {mode === 'find' && !asking && recent.length > 0 && (
                <Command.Group heading={<GroupHead label={t('shell.palette.recent')} n={recent.length} />}>
                  {recent.map((p) => (
                    <PageItem key={p.id} page={p} path={path(p)} onSelect={() => openPageItem(p.id)} />
                  ))}
                </Command.Group>
              )}
              {mode === 'find' && !asking && frequent.length > 0 && (
                <Command.Group heading={<GroupHead label={t('shell.palette.frequent')} n={frequent.length} />}>
                  {frequent.map((p) => (
                    <PageItem key={p.id} page={p} path={path(p)} onSelect={() => openPageItem(p.id)} />
                  ))}
                </Command.Group>
              )}
              {asking ? (
                <>
                  {sugGroup(topSugs, `${t('shell.palette.filter')} · ${sugs.head ?? ''}`)}
                  {commandsFirst && commandGroup}
                  {titleHits.length > 0 && (
                    <Command.Group heading={<GroupHead label={resultsLabel} n={text ? titleHits.length : (total ?? titleHits.length)} />}>{titleHits.map(pageHit)}</Command.Group>
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
                  {sugGroup(bottomSugs, sugs.head ?? t('shell.palette.filterBy'))}
                  {!readOnly && !filtering && text && (
                    <Command.Group className="pal-create">
                      <Command.Item value={`create:${text}`} className="pal-item" onSelect={() => (finish(), createPageAndOpen(null, text))}>
                        <span className="pal-item__icon">
                          <FilePlus2 size={16} />
                        </span>
                        <span className="pal-item__main">
                          <span className="pal-item__title">{t('shell.palette.createPage', { q: text })}</span>
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
          {mode === 'find' && more > 0 && (
            <div className="pal-more" role="status">
              {t('shell.palette.more', { n: more })}
            </div>
          )}
          <div className="pal-foot">
            <span>
              <span className="kbd">↑</span>
              <span className="kbd">↓</span> {t('shell.palette.navigate')}
            </span>
            <span>
              <span className="kbd">↵</span> {mode === 'ask' ? t('shell.palette.askGo') : t('shell.palette.open')}
            </span>
            {mode === 'find' && sugs.items.length > 0 ? (
              <span className="pal-foot__opt">
                <span className="kbd">Tab</span> {t('shell.palette.tabHint')}
              </span>
            ) : (
              mode === 'find' && (
                <span className="pal-foot__opt">
                  <span className="kbd">{ALT}↵</span> {t('shell.palette.pane')}
                </span>
              )
            )}
            <span className="pal-foot__spacer" />
            <button type="button" className="pal-foot__mode" data-on={mode === 'run' || undefined} onClick={() => setQuery(mode === 'run' ? '' : '>')}>
              <span className="kbd">&gt;</span> {t('shell.palette.commandsHint')}
            </button>
            <button type="button" className="pal-foot__mode" data-on={mode === 'ask' || undefined} onClick={() => setQuery(mode === 'ask' ? '' : '?')}>
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

/** The commands of the list without a query, most used first within their groups. */
const CORE = ['new-page', 'new-database', 'quick-note', 'templates', 'journal', 'agenda', 'graph', 'ask-ai', 'agent', 'present', 'history', 'import', 'settings', 'theme', 'focus', 'discover', 'tour']
const GROUP_ORDER: Cmd['group'][] = ['create', 'navigate', 'claude', 'page', 'workspace', 'start']

/** The list without a query: CORE in its order (the tour only until it was finished once). */
function rootCommands(commands: Cmd[], tourDone: boolean): Cmd[] {
  const byId = new Map(commands.map((c) => [c.id, c]))
  return CORE.filter((id) => !(id === 'tour' && tourDone))
    .map((id) => byId.get(id))
    .filter((c): c is Cmd => !!c)
}

function GroupHead({ label, n }: { label: string; n: number }) {
  return (
    <span className="pal-group">
      <span>{label}</span>
      <span className="pal-group__rule" />
      <span className="pal-group__n">{String(n).padStart(2, '0')}</span>
    </span>
  )
}

const dotStyle = (color: string) => ({ '--dot': `var(--c-${color}-text)` }) as CSSProperties

/** A filter suggestion: a key, an option, a person, a page … (Enter / Tab / click takes it). */
function SuggestionItem({ s, onSelect }: { s: Suggestion; onSelect: () => void }) {
  let icon: ReactNode
  if (s.kind === 'key' && s.type) icon = <TypeIcon type={s.type} size={15} />
  else if (s.kind === 'keyword') icon = <FilterIcon size={15} strokeWidth={1.7} />
  else if ((s.kind === 'option' || s.kind === 'person') && s.color) icon = <span className="pal-dot pal-dot--lg" style={dotStyle(s.color)} aria-hidden />
  else if (s.kind === 'person') icon = <AtSign size={15} strokeWidth={1.7} />
  else if (s.kind === 'database') icon = <Table2 size={15} strokeWidth={1.7} />
  else if (s.kind === 'page') icon = <FileText size={15} strokeWidth={1.7} />
  else if (s.kind === 'date') icon = <CalendarClock size={15} strokeWidth={1.7} />
  else if (s.kind === 'bool') icon = <ToggleLeft size={15} strokeWidth={1.7} />
  else if (s.kind === 'group') icon = <span className="pal-dot pal-dot--lg pal-dot--group" aria-hidden />
  else icon = <FilterIcon size={15} strokeWidth={1.7} />
  return (
    <Command.Item value={`sug:${s.id}`} className="pal-item pal-item--sug" onSelect={onSelect}>
      <span className="pal-item__icon">{icon}</span>
      <span className="pal-item__main">
        <span className="pal-item__line">
          <span className="pal-item__title">{s.label}</span>
        </span>
      </span>
      {s.hint && <span className="pal-item__hint">{s.hint}</span>}
      <span className="kbd pal-item__kbd pal-item__tab" aria-hidden>
        Tab
      </span>
    </Command.Item>
  )
}

function PageItem({
  page,
  path,
  titleRanges,
  snippet,
  props,
  db,
  onSelect,
}: {
  page: Page
  path: string
  titleRanges?: Range[]
  snippet?: { text: string; ranges: Range[] } | null
  /** the values a filter looked at */
  props?: ShownValue[]
  /** the row's database (shown where the path is hidden: phones) */
  db?: string
  onSelect: () => void
}) {
  const t = useT()
  const title = page.title.trim() || t('common.untitled')
  const hasProps = !!props?.length || !!db
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
          {page.private && (
            <span className="pal-item__lock" role="img" aria-label={t('shell.private.lock')} title={t('shell.private.lock')}>
              <Lock size={11} strokeWidth={2} />
            </span>
          )}
          {path && <span className="pal-item__path">{path}</span>}
        </span>
        {snippet ? (
          <span className="pal-item__snippet">{highlight(snippet.text, snippet.ranges)}</span>
        ) : (
          hasProps && (
            <span className="pal-item__props">
              {db && <span className="pal-prop pal-prop--db">{db}</span>}
              {props?.map((v, i) => (
                <span key={i} className="pal-prop">
                  <span className="pal-prop__k">{v.name}</span>
                  {v.color && <span className="pal-dot" style={dotStyle(v.color)} aria-hidden />}
                  <span className="pal-prop__v">{v.text}</span>
                </span>
              ))}
            </span>
          )
        )}
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
  /** media the MCP results returned: cards, saved into this page on a click (features/ai/media) */
  const [media, setMedia] = useState<MediaItem[]>([])
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
    setMedia([])
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
        onMedia: (items) => !ctrl.signal.aborted && setMedia(items),
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
    const doc = claudeDoc(answer, webImagesOf(page.content))
    const cur = page.content?.content ?? []
    useWorkspace.getState().setContent(page.id, { type: 'doc', content: [...cur, ...(doc.content ?? [])] }, 'ai')
    useUI.getState().toast({ message: t('shell.ask.appended'), kind: 'success' })
    onDone()
  }

  const toNewPage = () => {
    const id = useWorkspace.getState().createPage({ title: question.slice(0, 80), content: claudeDoc(answer) })
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
          {media.length > 0 && <MediaToPage items={media} pageId={page && page.kind === 'page' && !page.settings.locked ? page.id : null} disabled={readOnly} />}
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
  const doc = useMemo(() => (shown.trim() ? claudeDoc(shown) : null), [shown])
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
