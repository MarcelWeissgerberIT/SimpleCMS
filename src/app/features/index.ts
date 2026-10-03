/**
 * FEATURES AREA — public API (contract). Shell/editor/database import ONLY from this file.
 *
 *  Background services (started once from main.tsx after hydrate):
 *   - startHistory(): periodic page snapshots for version history
 *   - startAutomations(): runs database automations (webhooks …) on store changes
 *   - seedDemoHistory(pageId): back-dated versions for a freshly seeded page (version tape demo)
 *
 *  AI (Claude, bring-your-own-key):
 *   - isAIConfigured(), runAI(), AIMenu (component the editor shows for selection / "Ask AI")
 *
 *  Views / modals (rendered by the shell):
 *   - GraphView (route #/graph), SharedPageView (route #/s/…), Presentation (overlay)
 *   - HistoryModal, ShareModal, ImportModal, ExportModal, AutomationsModal, TemplatesModal
 *   - openTodayJournal()
 */
export { startHistory, seedDemoHistory } from './history/snapshots'
export { HistoryModal } from './history/HistoryModal'
export { startAutomations } from './automations/engine'
export { AutomationsModal } from './automations/AutomationsModal'
export { isAIConfigured, runAI, type AIAction, type RunAIOptions } from './ai/client'
export { AIMenu, type AIMenuProps } from './ai/AIMenu'
/*
 * AI meeting notes (the editor's `meetingNotes` node view renders these around the notes):
 *  - MeetingDeck: bar, title, record / pause / stop, live transcript, paste, Claude errors
 *  - MeetingFoot: privacy line + "Send action items to a database"
 */
export { MeetingDeck, type MeetingDeckProps } from './ai/meeting/MeetingDeck'
export { MeetingFoot } from './ai/meeting/MeetingFoot'
/*
 * Workspace agent (Claude runs tools over the workspace, every write is staged for review):
 *  - AgentPanel: right-hand sheet, mount once (renders nothing while closed; owns ⌘J / Ctrl+J)
 *  - openAgent({ task?, run? }) / closeAgent() / toggleAgent(); AGENT_SHORTCUT = 'Mod+J'
 */
export { AgentPanel, AGENT_SHORTCUT } from './ai/agent/AgentPanel'
export { openAgent, closeAgent, toggleAgent } from './ai/agent/state'
/*
 * AI autofill for database properties (the database area loads this lazily and owns the UI):
 *  - requestAutofill(req, signal): one row → Claude (structured output) → raw `value`
 *  - estimateAutofill(): rough token/cost estimate for a run · buildAutofillPrompt(): prompt + schema
 */
export {
  requestAutofill,
  estimateAutofill,
  buildAutofillPrompt,
  AUTOFILL_CONTENT_MAX,
  type AutofillRequest,
  type AutofillField,
  type AutofillFieldType,
  type AutofillTask,
  type AutofillRow,
  type AutofillAnswer,
  type AutofillEstimate,
} from './ai/autofill'
export { GraphView } from './graph/GraphView'
export { ShareModal } from './share/ShareModal'
export { SharedPageView } from './share/SharedPageView'
export { ImportModal } from './io/ImportModal'
export { ExportModal } from './io/ExportModal'
export { Presentation } from './present/Presentation'
export { TemplatesModal } from './templates/TemplatesModal'
export { openTodayJournal, journalEntryFor } from './journal/journal'
/*
 * Recurring database templates (template.repeat):
 *  - startRecurringTemplates(): background service — creates due rows while the app is open
 *    (start once from main.tsx after hydrate, like startHistory); runRecurringTemplates(): one pass
 *  - schedule helpers for the database area's repeat UI (pure): nextRun, upcoming, formatRun …
 */
export { startRecurringTemplates, stopRecurringTemplates, runRecurringTemplates, type RecurringNotice } from './templates/recurring'
export {
  nextRun,
  upcoming,
  scheduleChanged,
  defaultRepeat,
  formatRun,
  formatDay,
  weekdayKeys,
  weeklyDays,
  clampEvery,
  clampDayOfMonth,
  occurrenceRowId,
  fillRepeatVars,
  REPEAT_FREQS,
  REPEAT_VARIABLES,
  DEFAULT_REPEAT_TITLE,
  MAX_CATCH_UP,
  type Occurrence,
  type RepeatFreq,
} from './templates/schedule'
/*
 * Inbox (this device's notifications: reminders + team mentions / assignments / comment replies):
 *  - startInbox(): background service (start once from main.tsx after hydrate) · stopInbox()
 *  - useInbox (zustand: this workspace's items + settings), markRead / archiveItems / setNotify,
 *    openInboxItem, openInbox, eventLabel; notification permission helpers
 *  - reminder codes ('at', '-15m', '-1d' …): parse / label / due time / options (the one definition)
 *  - ReminderSelect, DateReminderEditor: reminder UI for database dates and editor date mentions
 *  - collectReminders(pages, dbs): every scheduled reminder (for lists / agenda)
 */
export { startInbox, stopInbox, openInboxItem, openInbox, eventLabel } from './inbox/engine'
export { useInbox, markRead, archiveItems, setNotify, INBOX_KINDS, type InboxItem, type InboxKind, type InboxData } from './inbox/state'
export { notifyPermission, requestNotifyPermission, type NotifyPermission } from './inbox/notify'
export { collectReminders, type ReminderEntry } from './inbox/scan'
export {
  parseReminder,
  isReminderCode,
  normalizeReminder,
  reminderDueAt,
  reminderLabel,
  reminderOptions,
  formatDue,
  hasTime,
  TIMED_REMINDERS,
  DAY_REMINDERS,
  DAY_REMINDER_HOUR,
} from './inbox/reminders'
export { ReminderSelect, DateReminderEditor, type DateReminderValue } from './inbox/ReminderControls'
/*
 * Folder + GitHub sync (a live Markdown copy of the workspace; this device's settings only):
 *  - startSync(): background service (start once from main.tsx after hydrate) · stopSync()
 *  - SyncTab: Settings → Sync · SyncStatusCell: status bar read-out (renders nothing while off)
 *  - openSyncSettings(): open Settings on the Sync tab · consumeSyncSettingsRequest(): SettingsModal asks on open
 */
export { startSync, stopSync, openSyncSettings, consumeSyncSettingsRequest, useSync, SyncTab, SyncStatusCell } from './sync'
