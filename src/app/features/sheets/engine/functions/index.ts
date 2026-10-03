/** The built-in library, in browser order: data first, then math, stats, logic, text, date, lookup, info. */
import type { FnSpec } from '../types'
import { dataFunctions } from './data'
import { mathFunctions } from './math'
import { statsFunctions } from './stats'
import { logicFunctions } from './logic'
import { textFunctions } from './text'
import { dateFunctions } from './date'
import { lookupFunctions } from './lookup'
import { infoFunctions } from './info'

export const BUILTINS: FnSpec[] = [...dataFunctions, ...mathFunctions, ...statsFunctions, ...logicFunctions, ...textFunctions, ...dateFunctions, ...lookupFunctions, ...infoFunctions]
