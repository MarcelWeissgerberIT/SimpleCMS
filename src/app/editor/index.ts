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
 */
export { PageEditor, type PageEditorProps } from './PageEditor'
export { ReadOnlyDoc } from './ReadOnlyDoc'
export { getExtensions, markdownToDoc, docToMarkdown, docToHTML, stripPrivate, stripPrivate as stripButtonActions } from './convert'
export { stripComments, commentIdsIn } from './schema/comment'
