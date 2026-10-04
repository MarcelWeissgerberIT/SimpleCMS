/**
 * Spreadsheet engine (pure TypeScript: no DOM, no store, no eval / Function / dynamic import of
 * user input). Built-ins are registered when the registry loads.
 */
import './evaluate'

export type { ErrorCode, ErrorValue, Scalar, CellValue, Area, RangeValue, DatasetValue, Value, FnCategory, ArgType, FnArg, FnCtx, FnSpec, ValueHint } from './types'
export { err, isErr, isRange, isDataset, isMulti, rangeValue, datasetOf, areasOf, singleArea, cellsOf, toScalar, toNumber, toText, toBool, parseNumeric, ERROR_CODES, MAX_STRING } from './values'
export { registerFunctions, getFunction, listFunctions, setCustomFunctions, isBuiltin, registryVersion, subscribeRegistry } from './registry'
export { callFunction, evaluateExpr, MAX_STEPS, MAX_CALL_DEPTH } from './evaluate'
export { parseFormula, MAX_FORMULA, MAX_DEPTH, type Node } from './parser'
export { lex, ParseError, type Tok, type RefTok, type RefPart } from './lexer'
export { Workbook, type SheetSource, type DatasetSource, type CellSource, type CellInfo } from './workbook'
export { formatValue, formatWithCode, formatDate, formatGeneral, BOOL_TEXT, type CellFormat, type FormatType } from './format'
export { literal, canonicalInput } from './input'
export { colName, colIndex, a1, parseA1, parseRect, rectText, isA1Like, quoteSheet, sameName, MAX_ROWS, MAX_COLS, type Rect } from './refs'
export { adjustFormula, adjustExpression, adjustRect, shiftFormula, renameSheetRefs, renameSheetInExpression, dropSheetRefs, rewriteFormula, rewriteRefs, refText, type StructOp } from './adjust'
export { paintFormula, callAt, wordAt, canPoint, type FormulaGroup, type FormulaPaint } from './analyze'
export { fillLine, type FillCell, type FillMode } from './series'
export { cellText, columnEntries, completeEntry, completeEntries, pickEntries, type ColumnSource } from './complete'
