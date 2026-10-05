/**
 * Global command registry: used by the command palette, the shortcuts sheet
 * and the global keyboard handler.
 */
import type { LucideIcon } from 'lucide-react'
import {
  Bell,
  CalendarDays,
  CalendarRange,
  Copy,
  Download,
  FilePlus2,
  FolderInput,
  Focus,
  Keyboard,
  Languages,
  LayoutTemplate,
  Link2,
  Lock,
  MessageSquareText,
  MoveHorizontal,
  PanelLeft,
  Presentation,
  Settings,
  Share2,
  SunMoon,
  Table2,
  Trash2,
  Upload,
  Waypoints,
  History,
  Star,
  Home,
  Inbox,
  Users,
  CloudUpload,
  Workflow,
  SquareFunction,
  CircleHelp,
} from 'lucide-react'
import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import { navigate } from '../../lib/router'
import { openTodayJournal, openAgent, AGENT_SHORTCUT, openFunctionBuilder } from '../../features'
import type { ID } from '../../store/types'
import type { Translate } from '@/shared/i18n'
import { quickNoteToInbox } from '../capture/inbox'
import { openHelp } from '../../help'
import { useCloud } from '../../cloud'
import { openCloudDialog, openSettingsTab } from '../cloud/state'
import {
  copyPageLink,
  createDatabaseAndOpen,
  createPageAndOpen,
  duplicateAndOpen,
  toggleFocusMode,
  toggleSidebar,
  toggleTheme,
  trashWithUndo,
  closeMobileSidebar,
} from './actions'

export interface Command {
  id: string
  label: string
  icon: LucideIcon
  /** "Mod+Shift+L" style; rendered with shortcutLabel() */
  shortcut?: string
  keywords?: string
  /** group for the palette */
  group: 'create' | 'page' | 'navigate' | 'workspace'
  run: () => void
}

/** Build the command list for the current context (page = page in the main column). */
export function buildCommands(t: Translate, pageId: ID | null): Command[] {
  const ws = useWorkspace.getState()
  const ui = useUI.getState()
  const page = pageId ? ws.pages[pageId] : undefined
  const live = page && !page.trashed
  const list: Command[] = [
    { id: 'new-page', group: 'create', label: t('shell.cmd.newPage'), icon: FilePlus2, shortcut: 'Mod+Alt+N', keywords: 'create add document neu seite', run: () => createPageAndOpen(null) },
    { id: 'new-database', group: 'create', label: t('shell.cmd.newDatabase'), icon: Table2, keywords: 'table board kanban datenbank tabelle', run: () => createDatabaseAndOpen(null) },
    { id: 'quick-note', group: 'create', label: t('shell.cmd.quickNote'), icon: Inbox, keywords: 'inbox capture jot memo eingang notiz schnell', run: () => { closeMobileSidebar(); quickNoteToInbox() } },
    { id: 'templates', group: 'create', label: t('shell.cmd.templates'), icon: LayoutTemplate, keywords: 'vorlagen gallery', run: () => ui.openModal({ type: 'templates', parentId: null }) },
    { id: 'journal', group: 'navigate', label: t('shell.cmd.journal'), icon: CalendarDays, keywords: 'today daily note tagebuch heute', run: () => { closeMobileSidebar(); openTodayJournal() } },
    { id: 'agenda', group: 'navigate', label: t('shell.cmd.agenda'), icon: CalendarRange, keywords: 'calendar kalender schedule termine week month woche monat upcoming due overdue fällig', run: () => { closeMobileSidebar(); navigate({ name: 'agenda' }) } },
    { id: 'inbox', group: 'navigate', label: t('shell.cmd.inbox'), icon: Bell, shortcut: 'G I', keywords: 'notifications reminders mentions benachrichtigungen erinnerungen erwähnungen posteingang', run: () => { closeMobileSidebar(); navigate({ name: 'inbox' }) } },
    { id: 'home', group: 'navigate', label: t('shell.cmd.home'), icon: Home, keywords: 'dashboard start', run: () => navigate({ name: 'home' }) },
    { id: 'graph', group: 'navigate', label: t('shell.cmd.graph'), icon: Waypoints, keywords: 'map network links karte', run: () => navigate({ name: 'graph' }) },
    { id: 'import', group: 'workspace', label: t('shell.cmd.import'), icon: Upload, keywords: 'notion markdown csv zip importieren', run: () => ui.openModal({ type: 'import' }) },
    { id: 'export', group: 'workspace', label: t('shell.cmd.export'), icon: Download, keywords: 'markdown html pdf backup exportieren', run: () => ui.openModal({ type: 'export', pageId: live ? page.id : null }) },
    { id: 'theme', group: 'workspace', label: t('shell.cmd.theme'), icon: SunMoon, shortcut: 'Mod+Shift+L', keywords: 'dark light mode carbon paper dunkel hell', run: toggleTheme },
    { id: 'sidebar', group: 'workspace', label: t('shell.cmd.sidebar'), icon: PanelLeft, shortcut: 'Mod+\\', keywords: 'collapse hide seitenleiste', run: toggleSidebar },
    { id: 'focus', group: 'workspace', label: t('shell.cmd.focus'), icon: Focus, shortcut: 'Mod+Shift+F', keywords: 'zen distraction free fokus', run: toggleFocusMode },
    {
      id: 'language',
      group: 'workspace',
      label: ws.settings.language === 'de' ? 'Switch to English' : 'Auf Deutsch umstellen',
      icon: Languages,
      keywords: 'language sprache english deutsch',
      run: () => ws.updateSettings({ language: ws.settings.language === 'de' ? 'en' : 'de' }),
    },
    { id: 'settings', group: 'workspace', label: t('shell.cmd.settings'), icon: Settings, shortcut: 'Mod+,', keywords: 'preferences einstellungen api key', run: () => ui.openModal({ type: 'settings' }) },
    { id: 'functions', group: 'workspace', label: t('features.fn.cmd'), icon: SquareFunction, keywords: 'custom functions formula spreadsheet build own eigene funktionen formel tabelle bauen fx', run: () => { closeMobileSidebar(); openFunctionBuilder() } },
    { id: 'shortcuts', group: 'workspace', label: t('shell.cmd.shortcuts'), icon: Keyboard, shortcut: 'Mod+/', keywords: 'keyboard keys help hilfe tastatur', run: () => ui.openModal({ type: 'shortcuts' }) },
    { id: 'help', group: 'workspace', label: t('help.title'), icon: CircleHelp, shortcut: '?', keywords: 'help hilfe manual handbuch docs documentation dokumentation faq support anleitung', run: () => openHelp() },
    { id: 'ask-ai', group: 'page', label: t('shell.cmd.askAI'), icon: MessageSquareText, keywords: 'claude ai assistant question ki frage', run: () => ui.openPalette('?') },
    { id: 'agent', group: 'workspace', label: t('features.agent.cmd'), icon: Workflow, shortcut: AGENT_SHORTCUT, keywords: 'agent claude ai automate bulk tasks rows pages ki automatisieren aufgaben terminal console konsole', run: () => { closeMobileSidebar(); openAgent() } },
  ]
  if (live) {
    // only while a page is open (nothing to nest under on Home or Graph); databases hold rows, not pages
    if (page.kind !== 'database' && !page.databaseId)
      list.splice(1, 0, { id: 'new-subpage', group: 'create', label: t('shell.cmd.newSubpage'), icon: FilePlus2, keywords: 'child nested unterseite', run: () => createPageAndOpen(page.id) })
    list.push(
      { id: 'present', group: 'page', label: t('shell.cmd.present'), icon: Presentation, keywords: 'slides presentation präsentieren', run: () => ui.present(page.id) },
      { id: 'share', group: 'page', label: t('shell.cmd.share'), icon: Share2, keywords: 'publish link teilen', run: () => ui.openModal({ type: 'share', pageId: page.id }) },
      { id: 'history', group: 'page', label: t('shell.cmd.history'), icon: History, keywords: 'versions restore verlauf', run: () => ui.openModal({ type: 'history', pageId: page.id }) },
      { id: 'favorite', group: 'page', label: page.favorite ? t('shell.cmd.unfavorite') : t('shell.cmd.favorite'), icon: Star, keywords: 'star pin favorit', run: () => ws.toggleFavorite(page.id) },
      { id: 'copy-link', group: 'page', label: t('common.copyLink'), icon: Link2, keywords: 'url', run: () => void copyPageLink(page.id) },
      { id: 'duplicate', group: 'page', label: t('common.duplicate'), icon: Copy, keywords: 'copy kopie', run: () => duplicateAndOpen(page.id) },
      { id: 'full-width', group: 'page', label: t('shell.cmd.fullWidth'), icon: MoveHorizontal, keywords: 'wide breit', run: () => ws.updatePageSettings(page.id, { fullWidth: !page.settings.fullWidth }) },
      { id: 'lock', group: 'page', label: page.settings.locked ? t('shell.cmd.unlock') : t('shell.cmd.lock'), icon: Lock, keywords: 'readonly sperren', run: () => ws.updatePageSettings(page.id, { locked: !page.settings.locked }) },
      { id: 'delete', group: 'page', label: t('shell.cmd.delete'), icon: Trash2, keywords: 'trash remove löschen papierkorb', run: () => trashWithUndo(page.id) },
    )
    // database rows belong to their database: no "Move to"
    if (!page.databaseId)
      list.splice(list.findIndex((c) => c.id === 'duplicate') + 1, 0, { id: 'move', group: 'page', label: t('shell.cmd.move'), icon: FolderInput, keywords: 'parent verschieben', run: () => ui.openModal({ type: 'move', pageId: page.id }) })
  }
  const cloud = useCloud.getState()
  if (cloud.available)
    list.push({ id: 'cloud-new', group: 'workspace', label: t('shell.cloud.cmd.newWorkspace'), icon: CloudUpload, keywords: 'team cloud workspace sync share invite neu', run: () => openCloudDialog(cloud.user ? 'new-workspace' : 'sign-in') })
  if (cloud.active.kind === 'cloud')
    list.push({ id: 'team', group: 'workspace', label: t('shell.cloud.cmd.team'), icon: Users, keywords: 'members invite people roles mitglieder einladen rollen', run: () => openSettingsTab('team') })
  // viewers read: nothing that creates, moves or deletes pages
  if (cloud.readOnly) return list.filter((c) => !EDITING.has(c.id))
  return list
}

/** Commands that write to the workspace (hidden for viewers). */
const EDITING = new Set(['new-page', 'new-subpage', 'new-database', 'quick-note', 'templates', 'journal', 'import', 'duplicate', 'move', 'delete', 'lock', 'full-width'])
