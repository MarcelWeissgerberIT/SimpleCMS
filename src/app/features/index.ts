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
/* a version of a page right now, before a structural edit (editor: "Turn into page") */
export { snapshotNow } from './history/snapshots'
/* aiWrite(fn): synchronous writes by Claude / an agent / an automation — the row's (page's) state right before is kept as an "AI" version (once per page per call) */
export { aiWrite } from './history/snapshots'
export { HistoryModal } from './history/HistoryModal'
export { startAutomations } from './automations/engine'
export { AutomationsModal } from './automations/AutomationsModal'
export { isAIConfigured, runAI, type AIAction, type RunAIOptions } from './ai/client'
/* one streamed completion with your own system prompt (help/ask.ts: "Ask the help", mcp: false = no MCP server) */
export { streamCompletion, type StreamOptions } from './ai/client'
export { AIMenu, type AIMenuProps } from './ai/AIMenu'
/*
 * AI-menu runs in the background (runs keep going when the panel closes; only Stop / Discard end them):
 *  - AIRunsHost { editor, pageId }: mount once per editable editor — the page's run plate, the panel on a run
 *  - AIRunLed { pageId }: the sidebar's LED for a page with a ready, unseen result (renders nothing otherwise)
 */
export { AIRunsHost, AIRunLed, type AIRunsHostProps } from './ai/RunsHost'
/*
 * Claude for images (an image block → describe / read out the text / image → table / ask; background runs):
 *  - startImageAction(editor, pos, action): 'describe' | 'read' | 'table' as a run, the page's AI panel opens on it
 *  - askAboutImage(editor, pos): the AI panel on that image with the prompt ready for a question
 */
export { startImageAction, askAboutImage } from './ai/image/actions'
export type { ImageAction } from './ai/image/request'
/*
 * Claude for files (any file block — uploads, mail attachments, web files): Claude summarises / extracts the text
 * as a page / extracts the tables / answers a question (the file goes to Anthropic only then), or One converts it
 * here (Word, text, Markdown, HTML, RTF → a page; CSV, TSV, Excel → a database / spreadsheet / table). Background
 * runs, previewed in the page's AI panel first:
 *  - fileActionsFor(name): the actions of a file by its name ([] = none) · fileActionLabel(t, action, kind, menu?)
 *    · FILE_ACTION_ICONS[action] · fileKindOf(name) · isLocalFileAction(action) (a conversion here, nothing sent)
 *  - startFileAction(editor, pos, action): a run, the page's AI panel opens on it · askAboutFile(editor, pos)
 */
export { startFileAction, askAboutFile } from './ai/file/actions'
export { fileActionsFor, fileActionLabel, FILE_ICONS as FILE_ACTION_ICONS } from './ai/file/menu'
export { fileKind as fileKindOf, isLocalAction as isLocalFileAction } from './ai/file/kinds'
export type { FileAction, FileKind } from './ai/file/kinds'
/*
 * "Transform into …" (features/ai/transform): selected blocks → Auto · Board · Table · Timeline · Diagram (mermaid) ·
 * Chart · Columns · Tabs · Toggles · Cards, previewed first (AIMenuProps.transform opens the panel on one at once):
 *  - transformChoicesAt(doc, from, to): the picks for a selection ([] = not offered) · TRANSFORM_ICONS[pick]
 */
export { transformChoicesAt, TRANSFORM_ICONS } from './ai/transform/forms'
export type { TransformPick } from './ai/transform/types'
/*
 * External MCP servers for Claude (Messages API MCP connector): McpServers = the section of
 * Settings → Claude AI (servers, sealed tokens, usage prompts, the MCP instructions template).
 */
export { McpServers } from './ai/mcp-servers/McpServers'
/*
 * MCP server codewords ("kb: …" in a free-form request — runAI applies them): CodewordChip { text } = the
 * "→ ATLAS" chip next to a prompt input · McpSkippedNote { calls } = the note for an addressed server that
 * stayed out (calls = what runAI's onMcp reported; McpCall entries with `skipped`)
 */
export { CodewordChip, McpSkippedNote } from './ai/mcp-servers/Codeword'
export type { McpCall } from './ai/mcp-servers/activity'
/*
 * One memory (features/ai/memory): Claude remembers what the person confirms (a database "One memory" +
 * its usage log) and takes the matching memories along with free-form requests:
 *  - memoryFor(task, { off? }) → { use, block } — pass `block` as runAI({ memory }); noteUse(answer, use,
 *    { task, where, pageId?, result? }) after the request (the memory log); MemoryNote { use }: "MEMORY · 2"
 *  - MemorySettings: the section of Settings → Claude AI
 *  - ExampleDialog { pageId, tag?, blocks?, onClose }: "Save as example in memory" (open it with
 *    useUI.openModal({ type: 'memoryExample', pageId }) — page ⋯ menu, /example in the AI terminal)
 */
export { memoryFor, noteUse, MemoryNote, MemorySettings, type MemoryUse } from './ai/memory'
/* a page (or a selection's blocks) as an example in the One memory — modal 'memoryExample' renders it */
export { ExampleDialog } from './ai/memory'
/*
 * AI meeting notes (the editor's `meetingNotes` node view renders these around the notes):
 *  - MeetingDeck: bar, title, record / pause / stop, live transcript, paste, Claude errors
 *  - MeetingFoot: privacy line + "Send action items to a database"
 */
export { MeetingDeck, type MeetingDeckProps } from './ai/meeting/MeetingDeck'
export { MeetingFoot } from './ai/meeting/MeetingFoot'
/*
 * AI terminal = the workspace agent (Claude runs tools over the workspace, every write is staged for review):
 *  - AgentPanel: the terminal dock (in .app-main; full screen on phones), mount once (renders nothing while
 *    hidden; owns ⌘J / Ctrl+J, ⌘⇧J "add to terminal", ⌘. stop). A task keeps running while it is hidden.
 *  - openAgent({ task?, run? }) / closeAgent() (hide; never stops) / toggleAgent(); AGENT_SHORTCUT = 'Mod+J'
 *  - AgentStatusCell: the status bar's "AI" LED cell (working / changes to review; click shows / hides)
 *  - addSelectionToTerminal(editor?): the selection (also in read-only pages) becomes a reference chip;
 *    AGENT_REF_SHORTCUT = 'Mod+Shift+J'
 */
export { AgentPanel, AGENT_SHORTCUT, AGENT_REF_SHORTCUT, addSelectionToTerminal } from './ai/agent/AgentPanel'
export { openAgent, closeAgent, toggleAgent } from './ai/agent/state'
export { AgentStatusCell } from './ai/agent/StatusCell'
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
 * Gmail → a "Mails" database (BYO Google OAuth client ID, gmail.readonly, token in memory only; this device's settings):
 *  - startMail(): background service (start once from main.tsx after hydrate): schedule + "Load images" in mail rows
 *  - MailTab: Settings → Mail · MailSyncLed { databaseId }: LED read-out for the Mails database's header (nothing elsewhere)
 *  - openMailSettings(): open Settings on the Mail tab · consumeMailSettingsRequest(): SettingsModal asks on open
 */
export { startMail, stopMail, openMailSettings, consumeMailSettingsRequest, useMail, MailTab, MailSyncLed } from './mail'
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
/*
 * Custom agents (Workspace.agents — saved AI helpers started by a schedule or a trigger; see agents/index.ts):
 *  - startAgents(): background service (start once from main.tsx after hydrate) — browser runner (leader tab)
 *  - AgentsRoute { agentId? } (route #/agents, #/agents/<id>) · AgentsNavBadge (sidebar: proposals to review)
 *  - ServerAgentsSettings (Settings → Agents · MCP, team workspaces) · agentLabel(actor) → "Agent · <name>" | null
 */
export { startAgents, AgentsRoute, AgentsNavBadge, useAgentsAttention, ServerAgentsSettings, agentLabel } from './agents'
/*
 * One Script (features/script — a small, safe script language that only reaches One; see script/index.ts):
 *  - ScriptsRoute { scriptId? } (route #/scripts, #/scripts/<id>) · ScriptDialogHost (mount once: what a run asks)
 *  - createScript(kind?, { name?, code?, open? }) · openScripts(id?) · saveScript · runScriptById(id, { mode? })
 *  - runScript({ code, mode: 'run' | 'dry' | 'query', … }) · registerEffect(name, impl) · loadScriptEngine()
 */
export {
  ScriptsRoute,
  ScriptDialogHost,
  createScript,
  openScripts,
  saveScript,
  duplicateScript,
  deleteScript,
  runScriptById,
  runScript,
  undoRun as undoScriptRun,
  stopScript,
  useActiveRuns as useActiveScriptRuns,
  registerEffect as registerScriptEffect,
  loadScriptEngine,
  appRunUI as appScriptUI,
  silentRunUI as silentScriptUI,
  type RunByIdOptions as ScriptRunByIdOptions,
  type RunOptions as ScriptRunOptions,
  type RunResult as ScriptRunResult,
  type RunUI as ScriptRunUI,
  type ScriptRun,
  type EffectName as ScriptEffectName,
  type EffectImpl as ScriptEffectImpl,
} from './script'
/*
 * Database commands (a database's menu of things to run — sidebar ⌘ key / row menu, toolbar key, ⌘K; see commands/index.ts):
 *  - DbCommandKey { dbId, variant, rowIds?, host?, onOpenChange? } · DbCommandsMenu (a row menu with the commands on top)
 *  - CommandsEditor (modal 'dbCommands') · openCommandsEditor(dbId) · paletteDbCommands() (⌘K entries)
 *  - registerCommandKind(def): the extension point for new kinds of own commands (e.g. "Run script")
 */
export {
  DbCommandKey,
  DbCommandsMenu,
  CommandsEditor,
  openCommandsEditor,
  paletteDbCommands,
  registerCommandKind,
  CommandFailure,
  readDbCommands,
  saveDbCommands,
  type DbCommandKeyProps,
  type CommandKindDef,
  type CommandPickerProps,
  type CommandRunContext,
  type CommandSurface,
  type CommandHost,
  type PaletteCommand,
} from './commands'
