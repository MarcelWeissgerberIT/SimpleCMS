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
 *  - Meeting notes: node `meetingNotes` (content: the notes; attrs: title, status, language, startedAt,
 *      endedAt, duration, transcript = [{ t, text }], recordedBy). Typed attrs + lookup helpers for the
 *      features area (features/ai/meeting runs the recording and Claude).
 */
export { PageEditor, type PageEditorProps } from './PageEditor'
export { ReadOnlyDoc } from './ReadOnlyDoc'
export { getExtensions, markdownToDoc, docToMarkdown, docToHTML, stripPrivate, stripPrivate as stripButtonActions, docSchema, prepareCollabContent } from './convert'
export { stripComments, commentIdsIn } from './schema/comment'
export { startSyncedBlocks, stopSyncedBlocks } from './synced/service'
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
