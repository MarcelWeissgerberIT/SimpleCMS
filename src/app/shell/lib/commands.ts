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
  SquareKanban,
  Trash2,
  Upload,
  Waypoints,
  History,
  Star,
  Home,
  Inbox,
  Users,
  Building2,
  CloudUpload,
  Workflow,
  SquareFunction,
  CircleHelp,
  Newspaper,
  SquareCode,
  GitBranch,
  Blocks,
  Compass,
  Route,
  ClipboardCopy,
} from 'lucide-react'
import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import { navigate } from '../../lib/router'
import { openTodayJournal, openAgent, AGENT_SHORTCUT, openFunctionBuilder, paletteDbCommands, createScript, openScripts, paletteScripts } from '../../features'
import type { ID } from '../../store/types'
import type { Translate } from '@/shared/i18n'
import { quickNoteToInbox } from '../capture/inbox'
import { openQuickCapture, QUICK_CAPTURE_SHORTCUT } from '../capture/state'
import { openHelp, openChangelog } from '../../help'
import { useCloud } from '../../cloud'
import { openCloudDialog } from '../cloud/state'
import { openWorkspaceSettings } from '../workspace/open'
import { startTour } from '../tour/state'
import { clearVisits } from './visits'
import {
  copyPageForAI,
  copyPageLink,
  createDatabaseAndOpen,
  createFreeBoardAndOpen,
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
  /**
   * group for the palette ('database': a database's command, "<database>: <command>" — found by typing only;
   * 'claude': Ask AI, the AI terminal; 'start': getting started — What can One do?, the tour, Help)
   */
  group: 'create' | 'page' | 'navigate' | 'claude' | 'workspace' | 'start' | 'database'
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
    { id: 'new-free-board', group: 'create', label: t('shell.cmd.newFreeBoard'), icon: SquareKanban, keywords: 'free board record types lanes freies board datensatz typen spalten', run: () => createFreeBoardAndOpen(null) },
    { id: 'quick-note', group: 'create', label: t('shell.cmd.quickNote'), icon: Inbox, keywords: 'inbox capture jot memo eingang notiz schnell', run: () => { closeMobileSidebar(); quickNoteToInbox() } },
    { id: 'quick-capture', group: 'create', label: t('shell.qcap.cmd'), icon: Inbox, shortcut: QUICK_CAPTURE_SHORTCUT, keywords: 'capture voice photo camera dictate inbox clippings erfassen sprache foto kamera diktieren ablage', run: () => { closeMobileSidebar(); openQuickCapture() } },
    { id: 'templates', group: 'create', label: t('shell.cmd.templates'), icon: LayoutTemplate, keywords: 'vorlagen gallery', run: () => ui.openModal({ type: 'templates', parentId: null }) },
    { id: 'new-script', group: 'create', label: t('features.script.cmd.new'), icon: SquareCode, keywords: 'script code automate query abfrage skript programm one script code automatisieren', run: () => { closeMobileSidebar(); createScript('script') } },
    { id: 'journal', group: 'navigate', label: t('shell.cmd.journal'), icon: CalendarDays, keywords: 'today daily note tagebuch heute', run: () => { closeMobileSidebar(); openTodayJournal() } },
    { id: 'agenda', group: 'navigate', label: t('shell.cmd.agenda'), icon: CalendarRange, keywords: 'calendar kalender schedule termine week month woche monat upcoming due overdue fällig', run: () => { closeMobileSidebar(); navigate({ name: 'agenda' }) } },
    { id: 'inbox', group: 'navigate', label: t('shell.cmd.inbox'), icon: Bell, shortcut: 'G I', keywords: 'notifications reminders mentions benachrichtigungen erinnerungen erwähnungen posteingang', run: () => { closeMobileSidebar(); navigate({ name: 'inbox' }) } },
    { id: 'home', group: 'navigate', label: t('shell.cmd.home'), icon: Home, keywords: 'dashboard start', run: () => navigate({ name: 'home' }) },
    { id: 'graph', group: 'navigate', label: t('shell.cmd.graph'), icon: Waypoints, keywords: 'map network links karte', run: () => navigate({ name: 'graph' }) },
    { id: 'scripts', group: 'navigate', label: t('features.script.cmd.open'), icon: SquareCode, keywords: 'scripts queries code one script skripte abfragen', run: () => { closeMobileSidebar(); openScripts() } },
    { id: 'kit', group: 'navigate', label: t('features.kit.cmd.open'), icon: Blocks, keywords: 'building blocks kit lists own property types record types shared list bausteine listen eigene typen datensatz', run: () => { closeMobileSidebar(); navigate({ name: 'kit' }) } },
    { id: 'coding', group: 'navigate', label: t('features.coding.cmd.open'), icon: GitBranch, keywords: 'coding pipeline claude code worker branch worktree tasks repo programmieren aufgaben', run: () => { closeMobileSidebar(); navigate({ name: 'coding' }) } },
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
    {
      id: 'clear-visits',
      group: 'workspace',
      label: t('shell.cmd.clearVisits'),
      icon: History,
      keywords: 'recent frequent visited history clear forget zuletzt häufig besucht verlauf leeren vergessen',
      run: () => {
        ws.clearRecent()
        clearVisits()
        ui.toast({ message: t('shell.sidebar.visitedCleared'), kind: 'success' })
      },
    },
    { id: 'shortcuts', group: 'workspace', label: t('shell.cmd.shortcuts'), icon: Keyboard, shortcut: 'Mod+/', keywords: 'keyboard keys help hilfe tastatur', run: () => ui.openModal({ type: 'shortcuts' }) },
    { id: 'help', group: 'start', label: t('help.title'), icon: CircleHelp, shortcut: '?', keywords: 'help hilfe manual handbuch docs documentation dokumentation faq support anleitung', run: () => openHelp() },
    { id: 'whats-new', group: 'workspace', label: t('help.news.cmd'), icon: Newspaper, keywords: "what's new whats new changelog updates release notes neuigkeiten neu in one änderungen versionshinweise", run: () => { closeMobileSidebar(); openChangelog() } },
    { id: 'ask-ai', group: 'claude', label: t('shell.cmd.askAI'), icon: MessageSquareText, keywords: 'claude ai assistant question ki frage', run: () => ui.openPalette('?') },
    { id: 'agent', group: 'claude', label: t('features.agent.cmd'), icon: Workflow, shortcut: AGENT_SHORTCUT, keywords: 'agent claude ai automate bulk tasks rows pages ki automatisieren aufgaben terminal console konsole', run: () => { closeMobileSidebar(); openAgent() } },
    { id: 'discover', group: 'start', label: t('shell.discover.cmd'), icon: Compass, keywords: 'discover features overview what can one do capabilities getting started entdecken funktionen überblick was kann einstieg', run: () => { closeMobileSidebar(); navigate('#/discover') } },
    { id: 'tour', group: 'start', label: t('shell.tour.cmd'), icon: Route, keywords: 'tour guide guided onboarding getting started intro walkthrough first steps einführung rundgang erste schritte anleitung', run: () => { closeMobileSidebar(); startTour() } },
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
      { id: 'copy-ai', group: 'page', label: t('shell.ai.copy'), icon: ClipboardCopy, keywords: 'ai claude context markdown prompt copy ki kontext kopieren', run: () => void copyPageForAI(page.id) },
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
  // the workspace page (#/workspace): its settings, and People (team: the members, invites and roles)
  list.push(
    { id: 'workspace', group: 'workspace', label: t('shell.ws.cmd.open'), icon: Building2, keywords: 'workspace settings overview name icon storage backup trash automation building blocks danger arbeitsbereich einstellungen überblick speicher sicherung papierkorb automatisierung bausteine', run: () => openWorkspaceSettings() },
    {
      id: 'people',
      group: 'workspace',
      label: cloud.active.kind === 'cloud' ? t('shell.ws.cmd.members') : t('shell.ws.cmd.people'),
      icon: Users,
      keywords: 'people persons members team invite roles merge rename personen mitglieder einladen rollen zusammenführen umbenennen',
      run: () => openWorkspaceSettings('people'),
    },
  )
  // database commands (features/commands): "Mails: Sync now", "Projects: New entry" … (viewers get only those that don't write)
  for (const c of paletteDbCommands()) list.push({ id: `db:${c.id}`, group: 'database', label: c.label, icon: c.icon, keywords: c.keywords, run: () => { closeMobileSidebar(); c.run() } })
  // saved scripts (features/script): "Run script: <name>" for the open page — found by typing, like the database commands
  for (const c of paletteScripts(live ? page.id : null)) list.push({ id: c.id, group: 'database', label: c.label, icon: c.icon, keywords: c.keywords, run: () => { closeMobileSidebar(); c.run() } })
  // viewers read: nothing that creates, moves or deletes pages
  if (cloud.readOnly) return list.filter((c) => !EDITING.has(c.id))
  return list
}

/** Commands that write to the workspace (hidden for viewers). */
const EDITING = new Set(['new-page', 'new-subpage', 'new-database', 'new-script', 'quick-note', 'templates', 'journal', 'import', 'duplicate', 'move', 'delete', 'lock', 'full-width'])
