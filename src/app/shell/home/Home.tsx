import { useMemo, type ReactNode } from 'react'
import { CalendarDays, FilePlus2, LayoutTemplate, Table2, Upload, ArrowRight } from 'lucide-react'
import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import { openTodayJournal } from '../../features'
import { PageIcon } from '../../ui/PageIcon'
import { shortcutLabel } from '../../ui/controls'
import { useFileUrl } from '../../lib/files'
import { colorBg } from '../../lib/colors'
import { useLang, useT } from '../../i18n'
import type { Page } from '../../store/types'
import { createDatabaseAndOpen, createPageAndOpen, goToPage } from '../lib/actions'
import { fmtDay, fmtNumber, fmtRelative, isoWeek, wordCount } from '../lib/format'
import { useNow } from '../lib/hooks'
import './home.css'

export function Home() {
  const t = useT()
  const lang = useLang()
  const now = useNow(60_000)
  const userName = useWorkspace((s) => s.settings.userName)
  const pages = useWorkspace((s) => s.pages)
  const recentIds = useWorkspace((s) => s.recent)

  const recent = useMemo(() => {
    const fromRecent = recentIds.map((id) => pages[id]).filter((p): p is Page => !!p && !p.trashed)
    if (fromRecent.length >= 6) return fromRecent.slice(0, 8)
    const rest = Object.values(pages)
      .filter((p) => !p.trashed && !p.databaseId && !fromRecent.includes(p))
      .sort((a, b) => b.updatedAt - a.updatedAt)
    return [...fromRecent, ...rest].slice(0, 8)
  }, [recentIds, pages])

  const stats = useMemo(() => {
    let docs = 0
    let dbs = 0
    let rows = 0
    let words = 0
    for (const p of Object.values(pages)) {
      if (p.trashed) continue
      if (p.kind === 'database') dbs++
      else if (p.databaseId) rows++
      else docs++
      words += wordCount(p.plain)
    }
    return { docs, dbs, rows, words }
  }, [pages])

  const hour = new Date(now).getHours()
  const greet = hour < 5 ? t('shell.home.night') : hour < 12 ? t('shell.home.morning') : hour < 18 ? t('shell.home.afternoon') : t('shell.home.evening')
  const ui = useUI.getState()

  return (
    <div className="home">
      <div className="home__inner">
        <div className="home__meta label">
          <span>§ 00 — {t('shell.nav.home')}</span>
          <span className="home__meta-rule" />
          <span>
            {fmtDay(now, lang)} · {t('shell.home.week', { n: isoWeek(now) })}
          </span>
        </div>
        <h1 className="display home__greet">
          {greet}
          {userName.trim() ? `, ${userName.trim()}` : ''}
          <span className="home__dot">.</span>
        </h1>
        <div className="home__readout" aria-label={t('shell.home.stats')}>
          <Readout n={stats.docs} label={t('shell.home.pages')} />
          <Readout n={stats.dbs} label={t('shell.home.databases')} />
          <Readout n={stats.rows} label={t('shell.home.rows')} />
          <Readout n={stats.words} label={t('shell.home.words')} />
        </div>

        <section className="home__section">
          <SectionLabel n="01" label={t('shell.home.actions')} />
          <div className="keys">
            <Key icon={<FilePlus2 size={18} />} label={t('common.newPage')} code="A1" kbd={shortcutLabel('Mod+Alt+N')} onClick={() => createPageAndOpen(null)} primary />
            <Key icon={<Table2 size={18} />} label={t('shell.cmd.newDatabase')} code="A2" onClick={() => createDatabaseAndOpen(null)} />
            <Key icon={<Upload size={18} />} label={t('shell.home.importNotion')} code="A3" onClick={() => ui.openModal({ type: 'import' })} />
            <Key icon={<LayoutTemplate size={18} />} label={t('shell.nav.templates')} code="A4" onClick={() => ui.openModal({ type: 'templates', parentId: null })} />
            <Key icon={<CalendarDays size={18} />} label={t('shell.nav.today')} code="A5" onClick={() => openTodayJournal()} />
          </div>
        </section>

        <section className="home__section">
          <SectionLabel n="02" label={t('shell.home.recent')} />
          {recent.length === 0 ? (
            <div className="home__empty">
              <p>{t('shell.home.noRecent')}</p>
              <button type="button" className="btn btn--primary" onClick={() => createPageAndOpen(null)}>
                <FilePlus2 size={15} />
                {t('common.newPage')}
              </button>
            </div>
          ) : (
            <div className="cards">
              {recent.map((p) => (
                <RecentCard key={p.id} page={p} lang={lang} />
              ))}
            </div>
          )}
        </section>

        <section className="home__section">
          <SectionLabel n="03" label={t('shell.home.tips')} />
          <ul className="tips">
            <Tip keys={['Mod+K']} text={t('shell.tips.palette')} />
            <Tip keys={['/']} text={t('shell.tips.slash')} />
            <Tip keys={['Alt', 'Click']} text={t('shell.tips.panes')} />
            <Tip keys={['Mod+Shift+F']} text={t('shell.tips.focus')} />
            <Tip keys={['Mod+\\']} text={t('shell.tips.sidebar')} />
            <Tip keys={['?']} text={t('shell.tips.help')} />
          </ul>
        </section>
      </div>
    </div>
  )
}

function SectionLabel({ n, label }: { n: string; label: string }) {
  return (
    <div className="home__label label">
      <span className="home__label-n">{n}</span>
      <span>{label}</span>
      <span className="home__meta-rule" />
    </div>
  )
}

function Readout({ n, label }: { n: number; label: string }) {
  const lang = useLang()
  return (
    <div className="readout">
      <span className="readout__n">{fmtNumber(n, lang)}</span>
      <span className="readout__l">{label}</span>
    </div>
  )
}

function Key({ icon, label, code, kbd, onClick, primary }: { icon: ReactNode; label: string; code: string; kbd?: string; onClick: () => void; primary?: boolean }) {
  return (
    <button type="button" className="key" data-primary={primary || undefined} onClick={onClick}>
      <span className="key__top">
        <span className="key__icon">{icon}</span>
        {kbd ? <span className="kbd key__kbd">{kbd}</span> : <span className="key__code">{code}</span>}
      </span>
      <span className="key__bottom">
        <span className="key__label">{label}</span>
        <ArrowRight size={14} className="key__arrow" />
      </span>
    </button>
  )
}

function RecentCard({ page, lang }: { page: Page; lang: 'en' | 'de' }) {
  const t = useT()
  const cover = page.cover
  const img = useFileUrl(cover?.type === 'image' ? cover.value : null)
  const style: React.CSSProperties | undefined =
    cover?.type === 'gradient' ? { background: cover.value } : cover?.type === 'color' ? { background: colorBg(cover.value) } : undefined
  return (
    <a
      href={`#/p/${page.id}`}
      className="card"
      data-no-pane=""
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey) return
        e.preventDefault()
        if (e.altKey) useUI.getState().openPane(page.id)
        else goToPage(page.id)
      }}
    >
      <span className="card__cover" style={style} data-empty={!cover || undefined}>
        {cover?.type === 'image' && img && <img src={img} alt="" loading="lazy" draggable={false} />}
        {!cover && <span className="card__ref">{page.kind === 'database' ? 'DB' : 'PG'}·{page.id.slice(0, 4).toUpperCase()}</span>}
      </span>
      <span className="card__icon">
        <PageIcon icon={page.icon} kind={page.kind} size={28} />
      </span>
      <span className="card__title" data-untitled={!page.title.trim() || undefined}>
        {page.title.trim() || t('common.untitled')}
      </span>
      <span className="card__meta">{fmtRelative(page.updatedAt, lang, t('shell.time.justNow'))}</span>
    </a>
  )
}

function Tip({ keys, text }: { keys: string[]; text: string }) {
  const t = useT()
  return (
    <li className="tip">
      <span className="tip__keys">
        {keys.map((k) => (
          <span key={k} className="kbd">
            {k === 'Click' ? t('shell.tips.click') : k === 'Alt' ? shortcutLabel('Alt') : shortcutLabel(k)}
          </span>
        ))}
      </span>
      <span className="tip__text">{text}</span>
    </li>
  )
}
