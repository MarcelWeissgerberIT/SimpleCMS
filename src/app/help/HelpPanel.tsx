/**
 * The Help panel (lazy chunk): a right-hand sheet built like a technical manual — name plate, tabs
 * (Manual · Ask · Keys), search, numbered chapters and articles, back / forward. Full screen on phones.
 * Above a dialog when one is open (a HelpLink in Settings), below menus and popovers otherwise.
 */
import { useEffect, useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { ArrowLeft, ArrowRight, ExternalLink, X } from 'lucide-react'
import { useLang, useT } from '../i18n'
import { useUI } from '../store/ui'
import { shortcutLabel } from '../ui/controls'
import { LIBRARY } from './content'
import { findArticle } from './library'
import { closeHelp, currentLoc, goHelp, helpBack, helpForward, tabOf, useHelp, type HelpLoc, type HelpTab } from './state'
import { changelogPublicUrl, helpPublicUrl } from './urls'
import { ArticleView, IndexView, ResultsView, SearchField, SectionView } from './views'
import { AskView } from './AskView'
import { ChangelogView, ChangeView, NewsStrip } from './changelog/views'

export default function HelpPanel({ shortcuts }: { shortcuts?: ReactNode }) {
  const t = useT()
  const lang = useLang()
  const loc = useHelp(currentLoc)
  const canBack = useHelp((s) => s.index > 0)
  const canForward = useHelp((s) => s.index < s.stack.length - 1)
  // above a dialog only while one is open: otherwise menus and popovers stay on top of the sheet
  const overModal = useUI((s) => !!s.modal)
  const tab = tabOf(loc)
  const panelRef = useRef<HTMLElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  // focus the search field on open; give focus back on close
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    const id = requestAnimationFrame(() => {
      const target = panelRef.current?.querySelector<HTMLElement>('[data-help-autofocus]')
      ;(target ?? panelRef.current)?.focus({ preventScroll: true })
    })
    return () => {
      cancelAnimationFrame(id)
      if (prev?.isConnected && !panelRef.current?.contains(prev)) prev.focus?.({ preventScroll: true })
    }
  }, [])

  // a new place starts at its top
  const key = locKey(loc)
  const first = useRef(true)
  useLayoutEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
    if (first.current) {
      first.current = false
      return
    }
    // keyboard users land on the new heading (the link they used is gone)
    const active = document.activeElement
    if (!active || active === document.body || !panelRef.current?.contains(active)) panelRef.current?.querySelector<HTMLElement>('[data-help-heading]')?.focus({ preventScroll: true })
  }, [key])

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    // keys typed in the sheet belong to it: a dialog underneath must neither close nor pull focus back
    if (e.key === 'Tab') {
      e.stopPropagation()
      return
    }
    if (e.key === 'Escape' && !e.nativeEvent.isComposing && !document.querySelector('[data-popover]')) {
      e.preventDefault()
      e.stopPropagation()
      const target = e.target as HTMLElement
      if (target === searchRef.current && useHelp.getState().query) {
        useHelp.setState({ query: '' })
        return
      }
      closeHelp()
      return
    }
    if (e.altKey && !e.metaKey && !e.ctrlKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      const el = e.target as HTMLElement
      if (el.closest('input, textarea')) return
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'ArrowLeft') helpBack()
      else helpForward()
      return
    }
    if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const el = e.target as HTMLElement
      if (el.closest('input, textarea, [contenteditable="true"]')) return
      e.preventDefault()
      if (tab !== 'manual') goManual()
      requestAnimationFrame(() => panelRef.current?.querySelector<HTMLInputElement>('.help-search__input')?.focus())
    }
  }

  const article = loc.kind === 'article' ? findArticle(LIBRARY, lang, loc.id) : undefined
  const publicUrl =
    loc.kind === 'changelog' ? changelogPublicUrl(lang) : loc.kind === 'change' ? changelogPublicUrl(lang, loc.id) : helpPublicUrl(lang, article?.id)

  return (
    <aside ref={panelRef} className="help" role="dialog" aria-modal="false" aria-labelledby="help-title" data-layer={overModal ? 'modal' : undefined} data-tab={tab} tabIndex={-1} onKeyDown={onKeyDown}>
      <header className="help-head">
        <div className="help-head__plate">
          <span className="label help-head__code">{t('help.code')}</span>
          <h2 id="help-title" className="help-head__title">
            {t('help.title')}
          </h2>
        </div>
        <div className="help-head__tools">
          <button type="button" className="icon-btn" onClick={helpBack} disabled={!canBack} aria-label={t('help.back')} title={`${t('help.back')} (${shortcutLabel('Alt+←')})`}>
            <ArrowLeft size={15} strokeWidth={1.7} />
          </button>
          <button type="button" className="icon-btn" onClick={helpForward} disabled={!canForward} aria-label={t('help.forward')} title={`${t('help.forward')} (${shortcutLabel('Alt+→')})`}>
            <ArrowRight size={15} strokeWidth={1.7} />
          </button>
          <a className="icon-btn help-head__web" href={publicUrl} target="_blank" rel="noopener" aria-label={t('help.public')} title={t('help.public')}>
            <ExternalLink size={14} strokeWidth={1.7} />
          </a>
          <button type="button" className="icon-btn" onClick={closeHelp} aria-label={t('help.close')} title={`${t('help.close')} (Esc)`}>
            <X size={16} strokeWidth={1.7} />
          </button>
        </div>
      </header>
      <Tabs tab={tab} />
      {tab === 'manual' && <SearchField inputRef={searchRef} />}
      <div className="help-scroll" ref={scrollRef} role="tabpanel" id={`help-tab-${tab}`} aria-labelledby={`help-tabbtn-${tab}`}>
        {tab === 'manual' && <Manual loc={loc} />}
        {tab === 'ask' && <AskView />}
        {tab === 'keys' && <KeysView shortcuts={shortcuts} />}
      </div>
    </aside>
  )
}

const locKey = (loc: HelpLoc) => `${loc.kind}:${'id' in loc ? loc.id : ''}`

function Manual({ loc }: { loc: HelpLoc }) {
  const query = useHelp((s) => s.query)
  if (loc.kind === 'search' && query.trim()) return <ResultsView query={query} />
  if (loc.kind === 'article') return <ArticleView id={loc.id} />
  if (loc.kind === 'section') return <SectionView id={loc.id} />
  if (loc.kind === 'changelog') return <ChangelogView />
  if (loc.kind === 'change') return <ChangeView key={loc.id} id={loc.id} />
  return <IndexView lead={<NewsStrip />} />
}

/** The Manual tab returns to the last place in the manual (or its index). */
function goManual() {
  const { stack, index } = useHelp.getState()
  for (let i = index; i >= 0; i--) if (tabOf(stack[i]) === 'manual') return goHelp(stack[i])
  goHelp({ kind: 'home' })
}

const TABS: HelpTab[] = ['manual', 'ask', 'keys']

function Tabs({ tab }: { tab: HelpTab }) {
  const t = useT()
  const go = (k: HelpTab) => (k === 'manual' ? goManual() : goHelp({ kind: k }))
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    if (e.altKey) return
    e.preventDefault()
    const next = TABS[(TABS.indexOf(tab) + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length]
    go(next)
    requestAnimationFrame(() => document.getElementById(`help-tabbtn-${next}`)?.focus())
  }
  return (
    <div className="help-tabs" role="tablist" aria-label={t('help.tabs')} onKeyDown={onKeyDown}>
      {TABS.map((k, i) => (
        <button
          key={k}
          type="button"
          role="tab"
          id={`help-tabbtn-${k}`}
          aria-selected={tab === k}
          aria-controls={`help-tab-${k}`}
          tabIndex={tab === k ? 0 : -1}
          className="help-tab"
          onClick={() => go(k)}
        >
          <span className="help-tab__n" aria-hidden>
            {String(i + 1).padStart(2, '0')}
          </span>
          {t(`help.tab.${k}`)}
        </button>
      ))}
    </div>
  )
}

function KeysView({ shortcuts }: { shortcuts?: ReactNode }) {
  const t = useT()
  return (
    <div className="help-keys">
      <h3 className="help-art__title" tabIndex={-1} data-help-heading>
        {t('help.keys.title')}
      </h3>
      <p className="help-art__summary">
        {t('help.keys.note', { keys: `${shortcutLabel('Mod+/')}` })}
      </p>
      {shortcuts}
    </div>
  )
}
