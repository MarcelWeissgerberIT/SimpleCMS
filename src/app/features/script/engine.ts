/**
 * One Script — the engine (loaded on demand: `loadScriptEngine()` in index.ts): the language, the
 * runner, the query builder's model, the catalog of names and the run summary. Everything here can be
 * used synchronously once loaded.
 */
export { runScript, evaluateSelection, undoRun, canUndo, errorInfo, type RunOptions, type RunResult } from './runtime/run'
export { summarize as summarizeRun, type SummaryLine } from './ui/summary'
export { parse, parseExpression, syntaxError, tokenize, walk, ScriptError, isScriptError, errorTextEn, ERROR_TEXT_EN, type Program, type Expr, type Stmt, type Pos, type ScriptErrorCode } from './lang'
export { fromCode as queryFromCode, toCode as queryToCode, type BQuery, type BCond, type BGroup, type BOp, type BVal } from './builder/model'
export { GLOBAL_FUNCTIONS, MEMBERS, signatureOf, type FnInfo } from './catalog'
