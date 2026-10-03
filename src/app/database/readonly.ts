/**
 * View only: viewers of a team workspace (and a revoked membership) read databases but change
 * nothing — no cell edits, rows, properties, views, drags, form building, templates, automations or
 * AI autofill. The cloud area decides (useCloud().readOnly); in the local workspace it is never set.
 * The UI hides every write affordance; the model actions refuse as well (and the cloud binding would
 * revert a viewer's local change anyway).
 */
import { useCloud } from '../cloud'

export const useDbReadOnly = (): boolean => useCloud((s) => s.readOnly)
export const isDbReadOnly = (): boolean => useCloud.getState().readOnly
