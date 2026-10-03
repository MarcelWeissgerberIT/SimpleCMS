/**
 * Spreadsheet engine — value and function types (shared contract, see features/sheets/index.ts).
 * Pure data: no DOM, no store, no code execution of user input anywhere in the engine.
 */
import type { CustomFunction } from '../../../store/types'

export type ErrorCode = '#DIV/0!' | '#REF!' | '#NAME?' | '#VALUE!' | '#N/A' | '#CYCLE!' | '#NUM!' | '#ERROR!'

export interface ErrorValue {
  readonly kind: 'error'
  readonly code: ErrorCode
  /** plain-language reason (English, for tooltips / logs) */
  readonly msg?: string
}

/** A cell's value: number (dates are serial numbers), text, boolean, blank (null) or an error. */
export type Scalar = number | string | boolean | null
export type CellValue = Scalar | ErrorValue

/** A rectangle of cells with their values (0-based). */
export interface Area {
  sheetId: string
  top: number
  left: number
  rows: number
  cols: number
  values: CellValue[][]
}

/** A reference / range evaluated as a function argument. */
export interface RangeValue extends Area {
  readonly kind: 'range'
}

/** DS(...): an ordered list of areas. Cells shared by several areas count once when flattened. */
export interface DatasetValue {
  readonly kind: 'dataset'
  readonly areas: Area[]
}

export type Value = CellValue | RangeValue | DatasetValue

/** 'custom' = a workspace function built by clicking (Workspace.functions). */
export type FnCategory = 'data' | 'math' | 'stats' | 'logic' | 'text' | 'date' | 'lookup' | 'info' | 'custom'

export type ArgType = 'number' | 'text' | 'bool' | 'date' | 'any' | 'range' | 'dataset' | 'criteria'

export interface FnArg {
  name: string
  type: ArgType
  optional?: boolean
  /** this and the following args repeat (SUM(number1; [number2]; …)) */
  repeat?: boolean
}

/** Display hint of a result: dates are numbers that should read as dates. */
export type ValueHint = 'date' | 'datetime' | 'percent' | null

export interface FnCtx {
  /** the recalculation's clock (TODAY / NOW) */
  now: Date
  lang: 'en' | 'de'
  /** custom-function call depth (recursion guard) */
  depth: number
  /** count work against the recalculation's step budget (throws when exhausted) */
  tick: (n?: number) => void
}

export interface FnSpec {
  name: string
  category: FnCategory
  minArgs: number
  maxArgs: number | null
  args: FnArg[]
  description: { en: string; de: string }
  example: string
  impl: (args: Value[], ctx: FnCtx) => Value
  /** extra search terms (e.g. the German Excel name: SVERWEIS) */
  keywords?: string
  /** what the result should look like (TODAY → date) */
  returns?: ValueHint
  /** re-evaluated on every full recalculation (TODAY, NOW) */
  volatile?: boolean
  /** set for custom functions */
  custom?: CustomFunction
}
