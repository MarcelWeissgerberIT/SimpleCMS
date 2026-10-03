/**
 * AI autofill (database area, internal). Config on PropertyDef.autofill; Claude calls go through
 * the features area's public API (loaded lazily). See store.ts for the run model.
 */
export { AUTOFILL_TYPES, autofillOf, canAutofill } from './config'
export { AutofillHost } from './AutofillPanel'
export { AiGlyph, AutofillCellMark, AutofillRowControl, AutofillTag } from './marks'
export { openAutofillPanel, startFill } from './store'
