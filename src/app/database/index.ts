/**
 * DATABASE AREA — public API (contract). Other areas import ONLY from this file.
 *  - DatabaseView: full database UI (view tabs, toolbar, table/board/list/gallery/calendar/timeline/chart/form).
 *      inline=true renders a compact embedded variant (used by the editor's databaseBlock node).
 *  - RowProperties: the property panel shown at the top of a row page.
 *  - propertyValueToText: plain-text rendering of a property value (search, export, AI context).
 *  - SharedFormView: the public page of a shared form (route #/f/<payload>; lazy-loaded inside).
 */
export { DatabaseView, type DatabaseViewProps } from './DatabaseView'
export { RowProperties } from './RowProperties'
export { propertyValueToText } from './values'
/** rowsOfView: rows of a view as it shows them (its filters + sorts) — for exports outside React. */
export { rowsOfView } from './model/ics'
export { SharedFormView } from './form/public'
/**
 * Properties created on the fly (also for the workspace agent / MCP tools):
 *  - createPropertyQuick(dbId, { name, type, relation?: { databaseId, twoWay?, reverseName? }, options?, numberFormat? },
 *      { toast? }) → the new PropertyDef (null: locked, view only, bad target). Default: an undo toast.
 *  - createPropertiesQuick(dbId, inputs) (no toast) · dropCreated(dbId, props) (their undo) ·
 *    canCreateProperties(dbId) · propertyByName(db, name) · freePropertyName(db, name)
 *  - CreatePropertyDialog: the short dialog (name · type · relation target + two-way) — render it yourself.
 *  - CreatePropertiesDialog: several fields at once ("check": create or not · "map": create / existing / skip).
 *  - PAGE_MENTIONED: window event the editor fires after inserting a page mention ({ from, to } page ids);
 *      row pages answer with the "link as relation?" offer.
 */
export { createPropertyQuick, createPropertiesQuick, dropCreated, canCreateProperties, propertyByName, freePropertyName, type QuickProperty } from './create/quick'
export { CreatePropertyDialog, type CreatePropertyDialogProps } from './create/CreatePropertyDialog'
export { CreatePropertiesDialog, DATA_TYPES, type CreatePropertiesDialogProps, type PropertySuggestion, type SuggestionResult } from './create/CreatePropertiesDialog'
export { PAGE_MENTIONED } from './create/RelationOffer'
