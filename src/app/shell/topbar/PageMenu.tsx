import { useCloud } from '../../cloud'
import { useBlockAuthors } from '../../editor/authors/preference'
import type { ReactNode } from 'react'
import { BookMarked, BookmarkPlus, ClipboardCheck, ClipboardCopy, Copy, Download, FolderInput, LayoutTemplate, Link2, Trash2, Upload, Share2, Clock3, Presentation, Zap, Rewind, Star, StarOff } from 'lucide-react'
import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import { inTemplate } from '../../store/selectors'
import { Popover } from '../../ui/Popover'
import { MenuList, type MenuEntry } from '../../ui/Menu'
import { useLang, useT } from '../../i18n'
import type { Page, PageFont } from '../../store/types'
import { copyPageForAI, copyPageLink, duplicateAndOpen, toggleFocusMode, trashWithUndo } from '../lib/actions'
import { toggleStar } from '../lib/favorites'
import { fmtNumber, fmtRelative, plural, wordCount } from '../lib/format'
import { useKbdHint } from '../lib/hooks'
import { useReadOnly } from '../cloud/state'
import { SwitchFace } from '../../ui/controls'
import { openAgentRun, openRecorder, REWIND_SHORTCUT, canSendToOrders, sendToOrders, sendToOrdersWithNote, useCoding } from '../../features'

const FONTS: Array<{ id: PageFont; key: string }> = [
  { id: 'sans', key: 'shell.font.default' },
  { id: 'serif', key: 'shell.font.serif' },
  { id: 'mono', key: 'shell.font.mono' },
]

export function PageMenu({ page, anchor, onClose, mobile }: { page: Page; anchor: HTMLElement | null; onClose: () => void; mobile: boolean }) {
  const t = useT()
  const lang = useLang()
  const blockAuthors = useBlockAuthors()
  const cloud = useCloud(s => s.active.kind === 'cloud' && !!s.supports?.includes('block-authors:1'))
  const focus = useUI((s) => s.focusMode)
  const kbd = useKbdHint()
  const ws = useWorkspace.getState()
  const ui = useUI.getState()
  const set = (patch: Partial<Page['settings']>) => ws.updatePageSettings(page.id, patch)
  const isDb = page.kind === 'database'
  // viewers keep what is theirs alone: focus mode, copy link, export
  const edit = !useReadOnly()
  // "Prüfen lassen" only while Coding is on on this device (re-renders when it is switched)
  const codingOn = useCoding((s) => s.enabled)
  const sendable = edit && codingOn && canSendToOrders(page.id, { menu: true })

  const focusRow = <ToggleRow seed="focus" label={t('shell.pageMenu.focus')} hint={kbd('Mod+Shift+F')} checked={focus} onChange={() => toggleFocusMode()} />
  // font and toggles: page settings are shared data, a viewer only gets focus mode
  const look: MenuEntry[] = edit
    ? [
        {
          kind: 'custom',
          render: () => (
            <div className="pm-fonts" role="radiogroup" aria-label={t('shell.font.label')}>
              {FONTS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  role="radio"
                  aria-checked={page.settings.font === f.id}
                  className="pm-font"
                  data-font={f.id}
                  onClick={() => set({ font: f.id })}
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  <span className="pm-font__ag">Ag</span>
                  <span className="pm-font__name">{t(f.key)}</span>
                </button>
              ))}
            </div>
          ),
        },
        { kind: 'separator' },
        {
          kind: 'custom',
          render: () => (
            <div className="pm-toggles">
              <ToggleRow seed="smallText" label={t('shell.pageMenu.smallText')} checked={page.settings.smallText} onChange={(v) => set({ smallText: v })} />
              <ToggleRow seed="fullWidth" label={t('shell.pageMenu.fullWidth')} checked={page.settings.fullWidth} onChange={(v) => set({ fullWidth: v })} />
              <ToggleRow seed="locked" label={t('shell.pageMenu.lock')} checked={page.settings.locked} onChange={(v) => set({ locked: v })} />
              {focusRow}
            </div>
          ),
        },
      ]
    : [{ kind: 'custom', render: () => <div className="pm-toggles">{focusRow}</div> }]
  const only = (on: boolean, list: MenuEntry[]) => (on ? list : [])

  const entries: MenuEntry[] = [
    ...look,
    ...(cloud && !isDb && !page.private ? [{ kind: 'custom' as const, render: () => <div className="pm-toggles"><ToggleRow seed="blockAuthors" label={t('shell.blockAuthors.toggle')} checked={blockAuthors.enabled} onChange={blockAuthors.set} /></div> }] : []),
    { kind: 'separator' },
    { label: t('shell.permalink.copy'), icon: <Link2 size={15} />, onSelect: () => void copyPageLink(page.id) },
    { label: t('shell.ai.copy'), icon: <ClipboardCopy size={15} />, onSelect: () => void copyPageForAI(page.id) },
    ...only(edit && !inTemplate(ws.pages, page.id), [{ label: t('features.agents.invoke.onPage'), icon: <Zap size={15} />, onSelect: () => openAgentRun({ pageId: page.id }) }]),
    // work orders: only while Coding is on here (features/coding/orders) — never for viewers
    ...only(sendable, [
      { label: t('features.coding.order.cmd.send'), icon: <ClipboardCheck size={15} />, onSelect: () => void sendToOrders(page.id) },
      { label: t('features.coding.order.cmd.sendNote'), icon: <ClipboardCheck size={15} />, onSelect: () => sendToOrdersWithNote(page.id) },
    ]),
    // the topbar's ☆ by name too: favourites are found where people look (this device's — viewers too)
    page.favorite
      ? { label: t('shell.menu.unfavorite'), icon: <StarOff size={15} />, onSelect: () => toggleStar(page.id) }
      : { label: t('shell.menu.favorite'), icon: <Star size={15} />, onSelect: () => toggleStar(page.id) },
    ...only(edit, [{ label: t('common.duplicate'), icon: <Copy size={15} />, onSelect: () => duplicateAndOpen(page.id) }]),
    // database rows belong to their database: no "Move to"
    ...only(edit && !page.databaseId, [{ label: t('shell.menu.moveTo'), icon: <FolderInput size={15} />, onSelect: () => ui.openModal({ type: 'move', pageId: page.id }) }]),
    ...only(mobile, [
      { label: t('shell.topbar.share'), icon: <Share2 size={15} />, onSelect: () => ui.openModal({ type: 'share', pageId: page.id }) },
      { label: t('shell.topbar.history'), icon: <Clock3 size={15} />, onSelect: () => ui.openModal({ type: 'history', pageId: page.id }) },
      { label: t('shell.topbar.present'), icon: <Presentation size={15} />, onSelect: () => ui.present(page.id) },
    ]),
    // the flight recorder (on a phone the only way in besides ⌘K: no status bar there)
    { label: t('features.recorder.menu'), icon: <Rewind size={15} />, hint: kbd(REWIND_SHORTCUT), onSelect: openRecorder },
    { kind: 'separator' },
    ...only(edit && isDb, [{ label: t('shell.pageMenu.automations'), icon: <Zap size={15} />, onSelect: () => ui.openModal({ type: 'automations', databaseId: page.id }) }]),
    { label: t('shell.cmd.export'), icon: <Download size={15} />, onSelect: () => ui.openModal({ type: 'export', pageId: page.id }) },
    ...only(edit, [
      { label: t('shell.cmd.import'), icon: <Upload size={15} />, onSelect: () => ui.openModal({ type: 'import' }) },
      { label: t('shell.cmd.templates'), icon: <LayoutTemplate size={15} />, onSelect: () => ui.openModal({ type: 'templates', parentId: page.id }) },
      // a page (with everything below it) becomes a template; rows have row templates, templates are templates already
      ...only(!page.databaseId && !inTemplate(ws.pages, page.id), [
        { label: t('features.tpl.save.menu'), icon: <BookmarkPlus size={15} />, onSelect: () => ui.openModal({ type: 'saveTemplate', pageId: page.id }) },
      ]),
      // the One memory: this page as an example ("take #tag as the template")
      ...only(!isDb && !inTemplate(ws.pages, page.id), [
        { label: t('features.memory.example.menu'), icon: <BookMarked size={15} />, onSelect: () => ui.openModal({ type: 'memoryExample', pageId: page.id }) },
      ]),
      { kind: 'separator' },
      { label: t('common.delete'), icon: <Trash2 size={15} />, danger: true, onSelect: () => trashWithUndo(page.id) },
    ]),
    {
      kind: 'custom',
      render: () => (
        <div className="pm-foot">
          {t('shell.pageMenu.edited', { when: fmtRelative(page.updatedAt, lang, t('shell.time.justNow')) })}
          {!isDb && <> · {t(plural('shell.stats.words', wordCount(page.plain)), { n: fmtNumber(wordCount(page.plain), lang) })}</>}
        </div>
      ),
    },
  ]

  return (
    <Popover open={!!anchor} anchor={anchor} onClose={onClose} placement="bottom-end" className="pm" role="menu" aria-label={t('shell.topbar.pageMenu')}>
      <MenuList entries={entries} onClose={onClose} />
    </Popover>
  )
}

function ToggleRow({ label, checked, onChange, hint, seed }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: ReactNode; seed: string }) {
  return (
    <div
      className="pm-toggle"
      role="menuitemcheckbox"
      aria-checked={checked}
      tabIndex={0}
      onClick={() => onChange(!checked)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          e.stopPropagation()
          onChange(!checked)
        }
      }}
    >
      <span className="pm-toggle__label">{label}</span>
      {hint && <span className="menu-item__hint">{hint}</span>}
      {/* the toggle's face only; the whole row is the control */}
      <SwitchFace checked={checked} size="sm" seed={seed} />
    </div>
  )
}
