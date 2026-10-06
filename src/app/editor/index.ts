/**
 * EDITOR AREA — public API (contract). Other areas import ONLY from this file.
 *  - PageEditor: the block editor for a page (TipTap). Reads/writes page content via the store.
 *  - ReadOnlyDoc: static, non-editable render of a doc (share view, history preview, presentation).
 *  - getExtensions(): schema extensions (for generateHTML / export).
 *  - markdownToDoc / docToMarkdown: conversion helpers (import/export/AI).
 *  - stripButtonActions(doc): the doc without anything workspace-private — button actions
 *      (webhook URLs, database ids) AND comment anchors (`comment` marks). Name kept for the
 *      existing callers (share links, site export); stripPrivate is the same function.
 *      docToHTML and docToMarkdown already apply it (comments: both; actions: HTML).
 *  - stripComments(doc): only the comment anchors. commentIdsIn(doc): thread ids anchored in a doc.
 *  - Tabs block: nodes `tabs` / `tab` (attrs: title). Which tab is shown is editor view state.
 *  - Team cloud: docSchema() (the document schema) and prepareCollabContent(json, ids) (schema-valid
 *      content with unique block ids) for writing TipTap JSON into a page's Y document.
 *  - Synced blocks: node `syncedBlock` (attrs: syncId, sourcePageId — null = the original, a page id =
 *      a reference holding a cached copy). startSyncedBlocks() (main.tsx, after the workspace loaded)
 *      keeps every copy in step via setContent(…, 'synced'); stripPrivate() unwraps them to plain blocks.
 *      syncedCopiesOutside(pageIds, counts?): copies on other pages of the originals on those pages.
 *  - Meeting notes: node `meetingNotes` (content: the notes; attrs: title, status, language, startedAt,
 *      endedAt, duration, transcript = [{ t, text }], recordedBy). Typed attrs + lookup helpers for the
 *      features area (features/ai/meeting runs the recording and Claude).
 *  - Inline icons: node `icon` (inline atom; attrs: kind 'asset' | 'lucide', name, color = ColorName | null,
 *      glyphs only). Markdown: ![Clock](assets/icons/clock.webp) / :icon-rocket@red:; plain text [Clock] /
 *      :rocket:. iconAssetPaths(doc): the public icon files a doc shows (for exports that copy files).
 *  - Charts: node `chart` (atom; attrs: spec = ChartSpec JSON — features/charts/types.ts). The live view, sources and
 *      builder come from features/charts; HTML = <figure data-type="chart" data-spec> + static SVG, Markdown = title +
 *      data table. stripPrivate() freezes live sources into the numbers they show (share links, exports).
 *  - Breadcrumb: node `breadcrumb` (atom; attrs: path = null — live: the path of the page it sits on). stripPrivate(),
 *      docToHTML() and docToMarkdown() freeze it into the titles [workspace, …ancestors, page] of the page whose content
 *      they are given; Markdown = "<!-- breadcrumb -->" + the path as a plain line (read back as the block).
 *  - fileBlock attr `display` ('viewer' | 'file' | null): a PDF shows in the browser's own viewer unless 'file'.
 *  - detectEmbedProvider(url): the embed provider a link is shown with (null: generic / not embeddable) — e.g. for
 *      the share codec's allowlist of received embeds.
 *  - Context marks — what Claude may read of a page for a request (per tab, in memory, never saved or synced):
 *      mode 'page' (default, everything) | 'marked' (only the marked top-level blocks, by block id — they follow
 *      every edit) | 'none' (nothing). contextMarksOf(editor) / pageContextMarks(pageId) / useContextMarks(pageId)
 *      → { mode, blocks, words, marked, total }; readableContent(pageId) → the same + markdown / plain of what may be
 *      read; readableBlocks(pageId) → those top-level blocks as TipTap JSON; setContextMode(editor | pageId, mode); openContextPicker(editor | pageId, { onEnd(done) }) — the picker
 *      on the page (boxes in the gutter, a bar at the bottom; Done / Esc), closeContextPicker(done),
 *      useContextPicking() (the page being picked, or null). The picker has a second purpose, 'redo' (passages to
 *      redo with instructions): openContextPicker(…, { purpose: 'redo', ids, onEnd(done, ids) }) — the marks go to
 *      onEnd only; topBlockKeys(editor, from, to) pre-marks a selection / the cursor block. startRedo(editor | pageId,
 *      { ids, onEnd }) — the redo picker from anywhere; on Done the page's AI panel opens on the passages
 *      (AIMenuProps.redo). While picking, the page's editor DOM is `inert` (typing paused); isEditable is untouched.
 *  - Turn into page: turnIntoPage(editor, { range?, pageId?, quiet? }) — the blocks a selection (or `range`, expanded to
 *      whole blocks of one container; list items split their list) covers become a new sub-page (private exactly when
 *      the page is) with ONE `pageLink` in their place; inline databases / linked sub-pages / comment threads go along;
 *      content written with origin 'split'; toast Undo + ⌘Z keep the store in step. Returns the new page id or null.
 *      SPLIT_SHORTCUT = 'Mod+Alt+9'.
 */
export { PageEditor, type PageEditorProps } from './PageEditor'
export { ReadOnlyDoc } from './ReadOnlyDoc'
/* Claude's change as its own undo step, also in a shared page (Y undo): startUndoStep(view) before building the transaction, endUndoStep(view) after dispatching it */
export { startUndoStep, endUndoStep } from './collab'
export { getExtensions, markdownToDoc, docToMarkdown, docToHTML, stripPrivate, stripPrivate as stripButtonActions, docSchema, prepareCollabContent } from './convert'
export { stripComments, commentIdsIn } from './schema/comment'
export { startSyncedBlocks, stopSyncedBlocks } from './synced/service'
export { syncedCopiesOutside } from './synced/state'
export { iconAssetPaths } from './schema/icon'
export { detectProvider as detectEmbedProvider } from './lib/embeds'
export {
  MEETING,
  meetingAttrs,
  findMeeting,
  readTranscript,
  formatOffset,
  transcriptWords,
  transcriptText,
  type MeetingAttrs,
  type MeetingStatus,
  type TranscriptSegment,
} from './schema/meetingNotes'
export { contextMarksOf, pageContextMarks, readableContent, readableBlocks, isContextLimited, useContextMarks, useContextPicking, type ContextMarks, type ReadableContent } from './context/read'
export { setContextMode, openContextPicker, closeContextPicker, contextPickingPage, topBlockKeys } from './context/api'
export { startRedo } from './context/redo'
/** liveEditorOf(pageId): the page's mounted editor (the main column's first, else a pane or the peek), null when it is not open — for writes that must be one undo step there (the AI terminal's edit_page). */
export { liveEditorOf } from './context/store'
export type { ContextMode, PickPurpose } from './context/store'
export { turnIntoPage, SPLIT_SHORTCUT, SPLIT_ORIGIN, type TurnIntoPageOptions } from './split/split'
/**
 * Button actions outside a button (features/commands: a database command of kind "Actions" uses the same list):
 *  - ButtonActionsEditor { actions, update(fn), pageId, rowDb, types?, create?, notes?, payload? }: the action list of
 *      the button's settings (cards, ↑↓, remove, "Add action"); `types` limits the kinds offered.
 *  - normalizeButtonActions(raw) (untrusted JSON → actions) · newButtonAction(type) · ButtonAction / ButtonActionType.
 *  - buttonPresetValues(db, presets, row | null, now) → { values } | { error } (the "@today" / "@toggle" / {{vars}} rules)
 *  - sendButtonWebhook(url, method, payload) → { ok, unconfirmed?, message } (lib/webhook: JSON + CORS, no-cors retry)
 *  - openButtonTarget(action) → { ok, text } (a page, or a URL in a new tab) · fillButtonVars(text): {{date}} {{time}} {{user}}
 */
export { ButtonActionsEditor, type ButtonActionsEditorProps } from './views/ButtonConfig'
export { normalizeActions as normalizeButtonActions, newAction as newButtonAction, type ButtonAction, type ButtonActionType, type PropertyPreset } from './schema/button'
export { presetValues as buttonPresetValues, sendWebhook as sendButtonWebhook, openTarget as openButtonTarget, fillVars as fillButtonVars } from './lib/buttonRun'
