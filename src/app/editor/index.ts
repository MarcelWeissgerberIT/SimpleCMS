/**
 * EDITOR AREA — public API (contract). Other areas import ONLY from this file.
 *  - PageEditor: the block editor for a page (TipTap). Reads/writes page content via the store.
 *  - ReadOnlyDoc: static, non-editable render of a doc (share view, history preview, presentation).
 *  - getExtensions(): schema extensions (for generateHTML / export).
 *  - markdownToDoc / docToMarkdown: conversion helpers (import/export/AI).
 */
export { PageEditor, type PageEditorProps } from './PageEditor'
export { ReadOnlyDoc } from './ReadOnlyDoc'
export { getExtensions, markdownToDoc, docToMarkdown, docToHTML } from './convert'
