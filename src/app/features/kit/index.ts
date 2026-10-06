/**
 * BUILDING BLOCKS (features/kit) — re-exported by features/index.ts. Shared lists, own property types
 * (a base + display + One Script bindings) and record types; the data lives in Workspace.kit (store/kit.ts,
 * written only with the store's kit actions).
 *
 * UI (rendered by the shell)
 *  - KitRoute { tab?, id? }: #/kit · #/kit/<lists|types|records> · #/kit/<tab>/<id> (lazy) — the record type
 *    editor lives here too · openKit(tab?, id?, { create? }) (create: the base menu of a new own type)
 *  - KitHost: mount once — validate refusals at their cells, the review dialog (team: someone else's scripts)
 *    and "Turn into list"
 *  - openTurnIntoList(items, name?) · listItemsIn(doc, from, to) (the AI menu's "Turn into list": one item per
 *    list item / line of the selection, nothing sent anywhere)
 *
 * Databases (the database area calls these)
 *  - kitTypeEntries(t, onPick, current?): the picker's "Own types" / "Bind to a list…" / "New own type…" entries;
 *    onPick gets a property definition (custom / listId / options …) for insertProperty or a type change
 *  - KitValue { db, prop, row, variant, children }: a value of an own type (display, format script, ƒ, ⚠, review chip)
 *  - writeUserValue(db, prop, rowIds, value, anchor?): what a person entered — validate → write → onChange
 *    (plain properties: written at once, synchronously) · isKitComputed(prop): a value script fills it (read-only)
 *  - useKitOptions(db, prop, rowId) / ensureKitOption(db, prop, option): an options script's choices in a picker
 *  - recomputeProperty(dbId, propId) → changed count ("Recompute values") · startKit(): background service (main.tsx)
 *  - ownTypeOf(prop): the own type of a property while it keeps the type's stored shape
 *
 * Tools (the AI terminal / MCP later): createList({ name, items, description?, icon? }) · createPropType({ name, base,
 *  listId?, display?, scripts?, … }) · createRecordType({ name, properties, color?, content? }) → the new id or null.
 *
 * Scripts run only through the One Script runtime (query mode; onChange: run mode, effects asked; never eval).
 * Team workspaces: a type's scripts run only in a version this device saved or confirmed (SHA-256 per code).
 */
export { KitRoute } from './KitRoute'
export { KitHost } from './host'
export { openKit, type KitTab } from './open'
export { openTurnIntoList } from './review'
export { listItemsIn } from './tolist'
export { kitTypeEntries, type OwnPropertyDef } from './picker'
export { KitValue, useKitOptions, ensureKitOption, type KitValueProps } from './cells'
export { writeUserValue, isKitComputed, kitChecksWrite } from './write'
export { recomputeProperty, startKit } from './recompute'
export { ownTypeOf, createList, createPropType, createRecordType, itemsFromText, type ListInput, type PropTypeInput, type RecordTypeInput } from './model'
