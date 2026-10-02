/**
 * DATABASE AREA — public API (contract). Other areas import ONLY from this file.
 *  - DatabaseView: full database UI (view tabs, toolbar, table/board/list/gallery/calendar/timeline/chart).
 *      inline=true renders a compact embedded variant (used by the editor's databaseBlock node).
 *  - RowProperties: the property panel shown at the top of a row page.
 *  - propertyValueToText: plain-text rendering of a property value (search, export, AI context).
 */
export { DatabaseView, type DatabaseViewProps } from './DatabaseView'
export { RowProperties } from './RowProperties'
export { propertyValueToText } from './values'
