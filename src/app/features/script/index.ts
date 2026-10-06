/**
 * ONE SCRIPT — public API (re-exported by features/index.ts). A small, safe script language that only
 * reaches One: pages, databases, people (+ mail / Claude / web as declared effects the person allows).
 * Scripts live in Workspace.scripts (store/scripts.ts; write only with upsertScript / deleteScript or
 * saveScript below); runs and trusted versions are per device (IndexedDB "one-scripts").
 *
 * UI (rendered by the shell)
 *  - ScriptsRoute { scriptId? }: #/scripts (list + template gallery) and #/scripts/<id> (workbench: the editor
 *    with type-aware completion, snippets, signature help — editor/complete.ts), lazy
 *  - ScriptDialogHost: what a running script asks (modal / confirm / ask / choose, the list of effects
 *    before a run, one more effect, more time, a team version to confirm) — mount once
 *  - createScript(kind?, { name?, code?, open? }) → id | null · openScripts(id?) · saveScript(script) ·
 *    duplicateScript(id) · deleteScript(id) (Undo toast)
 *
 * Running (integrations: buttons, database commands, automations, MCP, the AI terminal) — the engine
 * loads on first use, so these are async:
 *  - runScriptById(id, { mode?: 'run' | 'dry', contextPageId?, ui?, notify?, limits? }) → RunResult | null —
 *    a saved script with the app's dialogs, its run log and a toast with Undo (null: missing / already running)
 *  - runScript({ code, mode: 'run' | 'dry' | 'query', scriptId?, name?, contextPageId?, ui?, signal?, onLog?,
 *    record?, trusted?, limits?, table? }) → RunResult { status, value, plain, text, table, log, changes,
 *    effects, error, ms, run }: 'query' = read-only (writes, effects and dialogs refused — the query tester,
 *    tools) · 'dry' = reads for real, records every write and effect, executes none ("Probelauf") ·
 *    'run' = team: an unconfirmed version asks first; effects / trash are listed and confirmed once;
 *    writes with origin 'script', a version before the first change of each page; undoRun(run) restores
 *    `vars`: extra names the code sees ({ page } · { prop, row, raw } read like row.<Prop> · { plain }) — features/kit
 *  - undoRun(run) · stopScript(id) · useActiveRuns (scriptId → the run in progress in this tab)
 *  - isScriptTrusted({ code }) · trustScriptCode(code) · scriptCodeHash(code) · scriptsInTeam(): the team trust rule for
 *    code that is not a saved script (an own property type's bindings, features/kit)
 *  - loadScriptEngine(): the engine module for synchronous use (parse, syntaxError, tokenize, ScriptError,
 *    errorTextEn, queryFromCode / queryToCode — the builder's model, GLOBAL_FUNCTIONS / MEMBERS, summarizeRun …)
 *  - registerEffect('mail.send' | 'claude' | 'http.post', impl, { note? }) → restore(): replace an effect's default
 *    (`note()`: a short line the run's confirm list shows next to that effect, e.g. "via Gmail · ada@…")
 *    (mail.send: a mailto: draft · claude: the AI client with the person's key · http.post: a JSON POST).
 *    A run asks the person before any effect; dry runs and queries never call one.
 *  - appRunUI / silentRunUI: RunUI implementations (the app's dialogs · nobody is asked, defaults answer)
 *  - errorMessage(error, t): an ErrorInfo in the UI language
 *
 * Integrations (integrations/; registered at boot by importing this module)
 *  - database command kind "script" ("Run script": per selected row, else for the database page)
 *  - paletteScripts(pageId): ⌘K "Run script: <name>" entries and "New script from template…" (the template
 *    gallery under #/scripts, templates/: 20 scripts that adapt to the workspace) (shell/lib/commands.ts)
 *  - tools (model-facing English; MCP, the AI terminal, custom agents): runQueryForTool(code, { scope?,
 *    maxRows? }) → rows as JSON (read-only) · syntaxErrorText(code) · findScript(id | name) · scriptList() ·
 *    runReport(result, mode) · plannedItems(dryRun) + preApprovedUI(base, items) (a run whose list the
 *    person approved elsewhere) · SCRIPT_REFERENCE (the language on one page) · workspaceSketch()
 *  - draftWithClaude({ task, kind, code, signal }) → { code, error } (parsed; "Ask Claude" in the editor)
 */
import type { RunOptions, RunResult } from './runtime/run'
import type { ScriptRun } from './runtime/types'

export { ScriptsRoute } from './ScriptsRoute'
export { ScriptDialogHost } from './ui/DialogHost'
export { createScript, openScripts, saveScript, duplicateScript, deleteScript } from './actions'
export { runScriptById, stopScript, useActiveRuns, type RunByIdOptions } from './runtime/active'
export { registerEffect, effectNote, mailtoUrl, type EffectName, type EffectImpl, type EffectInputs, type EffectOutputs, type EffectEnv, type MailInput, type ClaudeInput, type HttpInput } from './runtime/effects'
export { appRunUI, silentRunUI } from './runtime/dialogs'
export { loadScriptRuns, useScriptRuns, MAX_RUNS } from './runtime/runs'
export { errorMessage } from './ui/errors'
export type { RunOptions, RunResult, RunVar } from './runtime/run'
/* team trust of code outside saved scripts (features/kit: an own property type's scripts): a version this device saved or confirmed */
export { codeHash as scriptCodeHash, isTrusted as isScriptTrusted, trustCode as trustScriptCode, inTeam as scriptsInTeam } from './runtime/trust'
export type { RunUI, RunMode, ScriptRun, LogLine, ChangeItem, EffectItem, ConfirmItem, ErrorInfo, ResultTable, Cell } from './runtime/types'
export type { BQuery, BCond, BGroup, BOp, BVal } from './builder/model'
export { SCRIPT_REFERENCE } from './reference'
export { paletteScripts, type PaletteScript } from './integrations/palette'
export { runQueryForTool, syntaxErrorText, errorTextOf, findScript, scriptList, runReport, plannedItems, preApprovedUI, TOOL_ROWS_MAX, TOOL_CODE_MAX, type QueryAnswer, type QueryOutcome } from './integrations/tools'
export { draftWithClaude, workspaceSketch, codeOf as scriptCodeOf } from './integrations/ask'
import './integrations/boot'

/** The engine module (language, runner, query model, catalog) — loaded once on first use. */
export const loadScriptEngine = () => import('./engine')

/** Run code (see the header). */
export async function runScript(o: RunOptions): Promise<RunResult> {
  return (await loadScriptEngine()).runScript(o)
}

/** Undo a run of this device's run log (pages it created go to the trash, everything else back). */
export async function undoRun(run: ScriptRun): Promise<boolean> {
  return (await loadScriptEngine()).undoRun(run)
}
