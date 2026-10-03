/** Datasets: DS(ref; ref; …) — evaluated by the interpreter in reference mode (names, ranges). */
import type { Area, FnSpec } from '../types'
import { isDataset, isErr, isRange } from '../values'
import { arg, def, err } from './helpers'

export const dataFunctions: FnSpec[] = [
  def(
    'DS',
    'data',
    [arg('area1', 'range'), arg('area2', 'range', { optional: true, repeat: true })],
    'Dataset: several areas of the table as one set of values — cells, ranges, whole columns, other sheets, other DS(…) or the name of a saved dataset. Cells in several areas count once.',
    'Datenbereich: mehrere Bereiche der Tabelle als eine Wertemenge — Zellen, Bereiche, ganze Spalten, andere Tabellenblätter, weitere DS(…) oder der Name eines gespeicherten Datenbereichs. Zellen in mehreren Bereichen zählen einmal.',
    '=SUM(DS(A1:A10; B2:B7))',
    (a) => {
      const areas: Area[] = []
      for (const v of a) {
        if (isErr(v)) return v
        if (isDataset(v)) areas.push(...v.areas)
        else if (isRange(v)) areas.push(v)
        else return err('#VALUE!', 'DS takes references, ranges, datasets or dataset names')
      }
      return { kind: 'dataset', areas }
    },
    { keywords: 'dataset datenbereich data daten areas bereiche ds' },
  ),
]
