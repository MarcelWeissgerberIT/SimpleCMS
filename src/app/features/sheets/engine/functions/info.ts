/** Information: what kind of value a cell holds. */
import type { FnSpec } from '../types'
import { isMulti, isRange, toScalar } from '../values'
import { arg, def, err, isErr } from './helpers'

const ANY = (name: string) => arg(name, 'any')

export const infoFunctions: FnSpec[] = [
  def('ISBLANK', 'info', [ANY('value')], 'TRUE when the cell is empty.', 'WAHR, wenn die Zelle leer ist.', '=ISBLANK(A1)', (a) => toScalar(a[0]) === null, { keywords: 'ISTLEER empty leer' }),
  def('ISNUMBER', 'info', [ANY('value')], 'TRUE for a number (dates are numbers).', 'WAHR für eine Zahl (Daten sind Zahlen).', '=ISNUMBER(A1)', (a) => typeof toScalar(a[0]) === 'number', { keywords: 'ISTZAHL number zahl' }),
  def('ISTEXT', 'info', [ANY('value')], 'TRUE for text.', 'WAHR für Text.', '=ISTEXT(A1)', (a) => typeof toScalar(a[0]) === 'string', { keywords: 'ISTTEXT text' }),
  def('ISLOGICAL', 'info', [ANY('value')], 'TRUE for TRUE or FALSE.', 'WAHR für WAHR oder FALSCH.', '=ISLOGICAL(A1)', (a) => typeof toScalar(a[0]) === 'boolean', { keywords: 'ISTLOG boolean wahrheitswert' }),
  def('ISERROR', 'info', [ANY('value')], 'TRUE for any error value.', 'WAHR für jeden Fehlerwert.', '=ISERROR(A1/B1)', (a) => (isMulti(a[0]) && !(isRange(a[0]) && a[0].rows * a[0].cols === 1) ? false : isErr(toScalar(a[0]))), { keywords: 'ISTFEHLER error fehler' }),
  def('ISNA', 'info', [ANY('value')], 'TRUE for #N/A.', 'WAHR für #NV.', '=ISNA(MATCH(A1; B:B; 0))', (a) => {
    const v = toScalar(a[0])
    return isErr(v) && v.code === '#N/A'
  }, { keywords: 'ISTNV not available' }),
  def('NA', 'info', [], 'The #N/A error (no value available).', 'Der Fehler #NV (kein Wert verfügbar).', '=NA()', () => err('#N/A'), { keywords: 'NV' }),
]
