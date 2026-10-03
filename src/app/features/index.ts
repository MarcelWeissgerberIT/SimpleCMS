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
 *   - HistoryModal, ShareModal, ImportModal, ExportModal, AutomationsModal, TemplatesModal, SaveTemplateModal
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
/* CSV into an existing database (pure; the database area owns the dialog): plan + converted rows */
export { planCsvIntake, csvIntakeRows, CSV_INTAKE_MAX_ROWS, type CsvIntakePlan, type CsvIntakeColumn } from './io/import/intake'
export { ExportModal } from './io/ExportModal'
export { Presentation } from './present/Presentation'
export { TemplatesModal } from './templates/TemplatesModal'
/*
 * Own templates (Page.template — a template is a hidden page subtree, see templates/own.ts):
 *  - SaveTemplateModal (modal 'saveTemplate': "Save as template…" in the page menu)
 *  - TemplateBanner: the "TEMPLATE · <name>" plate on every page of a template (PageView renders it;
 *    nothing on other pages) · templateRoots(pages) / templateName(page): for lists (palette)
 */
export { SaveTemplateModal } from './templates/SaveTemplateModal'
export { TemplateBanner } from './templates/TemplateBanner'
export { templateRoots, templateName } from './templates/own'
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
/*
 * One MCP, local bridge (Claude Desktop / Claude Code drive this tab through mcp/one-mcp.mjs):
 *  - startMcp(): background service (start once from main.tsx after hydrate; idle until switched on)
 *  - McpTab: Settings → Agents · MCP · McpStatusCell: status bar "AGENT" LED (renders nothing while unused)
 *  - openMcpSettings(): open Settings on that tab · consumeMcpSettingsRequest(): SettingsModal asks on open
 */
export { startMcp, McpTab, McpStatusCell, openMcpSettings, consumeMcpSettingsRequest } from './mcp'
/*
 * Custom functions, built by clicking — no code (Workspace.functions; usable in spreadsheet cells and database formulas):
 *  - startCustomFunctions(): background service (start once from main.tsx after hydrate) — pushes the workspace's
 *    functions into the spreadsheet engine and offers them to database formulas, on every change
 *  - openFunctionBuilder(id?): open the "Functions" dialog (modal 'functions') · FunctionsModal (lazy)
 *  - demoFunctions(lang): MARGIN(price; cost) for the seed
 */
export { startCustomFunctions, openFunctionBuilder, FunctionsModal, demoFunctions } from './sheets/functions'
/*
 * Spreadsheets (`spreadsheet` block: several sheets, Excel-style formulas, built-in library, datasets DS(…)):
 *  - engine: formulas, function registry (registerFunctions / getFunction / listFunctions / setCustomFunctions),
 *    Workbook, formatValue, reference adjustment · readAttrs(attrs): typed + sanitized node attrs
 *  - readSheetData(attrs, ref): computed values of a range / DS(…) / dataset name (charts)
 *  - spreadsheet exports (Markdown / HTML with computed values) and the lazy grid UI (loadSheetBlock)
 */
export {
  registerFunctions,
  getFunction,
  listFunctions,
  setCustomFunctions,
  callFunction,
  evaluateExpr,
  readSheetData,
  readAttrs as readSpreadsheetAttrs,
  newSpreadsheetAttrs,
  spreadsheetMarkdown,
  spreadsheetHTML,
  loadSheetBlock,
  type FnSpec,
  type Value as SheetValue,
  type CellValue as SheetCellValue,
  type SpreadsheetAttrs,
} from './sheets'
/*
 * Charts (pure SVG, Instrument look — the `chart` block, spreadsheet charts, database chart view; see charts/index.ts):
 *  - ChartRenderer { spec, data, height?, interactive? } · useChartData(source, spec?) → { data, loading } (live)
 *  - tableToChartData(values, spec?) · openChartBuilder({ initial?, source?, allowedSources?, onSave, inline? … })
 *  - chartToSvg(spec, data, { width, theme }) · chartDomSpec · chartMarkdown · freezeCharts(doc) (exports, shares)
 *  - normalizeSpec(raw) (untrusted JSON → ChartSpec | null) · downloads (PNG / SVG) · copyChartTsv · demoCharts()
 */
export {
  ChartRenderer,
  DataTable as ChartDataTable,
  useChartData,
  resolveChartData,
  resolveChartDataSync,
  tableToChartData,
  chartDataToRows,
  chartDataToTsv,
  openChartBuilder,
  closeChartBuilder,
  chartToSvg,
  chartDomSpec,
  chartMarkdown,
  freezeCharts,
  frozenSpec,
  normalizeSpec as normalizeChartSpec,
  suggestKind as suggestChartKind,
  chartHeight,
  formatValue as formatChartValue,
  downloadChartPng,
  downloadChartSvg,
  copyChartTsv,
  demoCharts,
  CHART_KINDS,
  CHART_NODE,
  type ChartKind,
  type ChartData,
  type ChartSeries,
  type ChartSource,
  type ChartSourceKind,
  type ChartSpec,
  type CellValue as ChartCellValue,
  type ChartBuilderOptions,
  type ChartRendererProps,
} from './charts'
