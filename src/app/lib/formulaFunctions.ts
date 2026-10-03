/**
 * Functions from outside the database formula language: the workspace's custom functions, built by
 * clicking (features/sheets/functions registers them here, again on every change; the database
 * formula engine looks names up here). A neutral meeting point, so neither area loads the other.
 * Names match case-insensitively; values are the formula language's plain values.
 */

/** A database formula value (database/formula FValue). */
export type FormulaPlain = number | string | boolean | Date | null | FormulaPlain[]

export type FormulaCallResult = { ok: true; value: FormulaPlain } | { ok: false; code: string; msg?: string }

export interface FormulaFunctions {
  /** the canonical name of a function this source knows, else null */
  resolve(name: string): string | null
  /** [min, max] arguments (max -1 = any number) */
  arity(name: string): [number, number]
  call(name: string, args: FormulaPlain[], opts: { now: number; lang: 'en' | 'de' }): FormulaCallResult
  /** for the formula editor's reference list */
  list(): Array<{ name: string; sig: string; description: string }>
}

let current: FormulaFunctions | null = null
let version = 0

export const formulaFunctions = (): FormulaFunctions | null => current

/** Bumps on every registration (compiled formulas are stale then). */
export const formulaFunctionsVersion = (): number => version

export function setFormulaFunctions(f: FormulaFunctions | null): void {
  current = f
  version++
}
