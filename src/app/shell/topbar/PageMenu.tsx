import type { ReactNode } from 'react'
import { Copy, Download, FolderInput, LayoutTemplate, Link2, Trash2, Upload, Share2, Clock3, Presentation, Zap } from 'lucide-react'
import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import { Popover } from '../../ui/Popover'
import { MenuList, type MenuEntry } from '../../ui/Menu'
import { useLang, useT } from '../../i18n'
import type { Page, PageFont } from '../../store/types'
import { copyPageLink, duplicateAndOpen, toggleFocusMode, trashWithUndo } from '../lib/actions'
import { fmtNumber, fmtRelative, plural, wordCount } from '../lib/format'
import { useKbdHint } from '../lib/hooks'

const FONTS: Array<{ id: PageFont; key: string }> = [
  { id: 'sans', key: 'shell.font.default' },
  { id: 'serif', key: 'shell.font.serif' },
  { id: 'mono', key: 'shell.font.mono' },
]

export function PageMenu({ page, anchor, onClose, mobile }: { page: Page; anchor: HTMLElement | null; onClose: () => void; mobile: boolean }) {
  const t = useT()
  const lang = useLang()
  const focus = useUI((s) => s.focusMode)
  const kbd = useKbdHint()
  const ws = useWorkspace.getState()
  const ui = useUI.getState()
  const set = (patch: Partial<Page['settings']>) => ws.updatePageSettings(page.id, patch)
  const isDb = page.kind === 'database'

  const entries: MenuEntry[] = [
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
          <ToggleRow label={t('shell.pageMenu.smallText')} checked={page.settings.smallText} onChange={(v) => set({ smallText: v })} />
          <ToggleRow label={t('shell.pageMenu.fullWidth')} checked={page.settings.fullWidth} onChange={(v) => set({ fullWidth: v })} />
          <ToggleRow label={t('shell.pageMenu.lock')} checked={page.settings.locked} onChange={(v) => set({ locked: v })} />
          <ToggleRow label={t('shell.pageMenu.focus')} hint={kbd('Mod+Shift+F')} checked={focus} onChange={() => toggleFocusMode()} />
        </div>
      ),
    },
    { kind: 'separator' },
    { label: t('common.copyLink'), icon: <Link2 size={15} />, onSelect: () => void copyPageLink(page.id) },
    { label: t('common.duplicate'), icon: <Copy size={15} />, onSelect: () => duplicateAndOpen(page.id) },
    // database rows belong to their database: no "Move to"
    ...(page.databaseId ? [] : ([{ label: t('shell.menu.moveTo'), icon: <FolderInput size={15} />, onSelect: () => ui.openModal({ type: 'move', pageId: page.id }) }] as MenuEntry[])),
    ...(mobile
      ? ([
          { label: t('shell.topbar.share'), icon: <Share2 size={15} />, onSelect: () => ui.openModal({ type: 'share', pageId: page.id }) },
          { label: t('shell.topbar.history'), icon: <Clock3 size={15} />, onSelect: () => ui.openModal({ type: 'history', pageId: page.id }) },
          { label: t('shell.topbar.present'), icon: <Presentation size={15} />, onSelect: () => ui.present(page.id) },
        ] as MenuEntry[])
      : []),
    { kind: 'separator' },
    ...(isDb ? ([{ label: t('shell.pageMenu.automations'), icon: <Zap size={15} />, onSelect: () => ui.openModal({ type: 'automations', databaseId: page.id }) }] as MenuEntry[]) : []),
    { label: t('shell.cmd.export'), icon: <Download size={15} />, onSelect: () => ui.openModal({ type: 'export', pageId: page.id }) },
    { label: t('shell.cmd.import'), icon: <Upload size={15} />, onSelect: () => ui.openModal({ type: 'import' }) },
    { label: t('shell.cmd.templates'), icon: <LayoutTemplate size={15} />, onSelect: () => ui.openModal({ type: 'templates', parentId: page.id }) },
    { kind: 'separator' },
    { label: t('common.delete'), icon: <Trash2 size={15} />, danger: true, onSelect: () => trashWithUndo(page.id) },
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

function ToggleRow({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: ReactNode }) {
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
      {/* visual rocker; the whole row is the control */}
      <span className="switch" aria-checked={checked} aria-hidden />
    </div>
  )
}
