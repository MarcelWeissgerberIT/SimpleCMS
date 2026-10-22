---
id: workspace-translations
title: Workspace content in two languages
section: writing
order: 17
keywords: translation, translate, language, workspace, English, German, localisation
related: workspace, ai-providers, export
summary: Review and save English or German variants on the same pages, without duplicating the workspace.
---
One separates **interface language** from **content language**. Content defaults to **Follow interface**. A saved English or German variant appears automatically when its language is selected. **Original** shows the editable source. This preference belongs to this device and workspace; it changes no other member's view or provider settings.

## Create a translation
Choose **Translate…** below a page title, or open **Workspace → Data → Workspace translations**. Select the original and target languages and a scope: this page, this page with its children, or all shared workspace pages. Whole-workspace translation excludes private pages, templates, trash and locked pages. A page selection only includes its own accessible subtree.

Choose any configured provider and model supported by the request's selector. **Generate preview** sends the selected text through One's existing data rules, metering and budgets. Opening the dialog, changing the display language and reviewing an existing translation make no model calls. MCP tools are disabled for translation requests. A route that redacts part of the original is refused rather than saving an incomplete translation.

Review the proposed text, correct individual fragments if needed, then choose **Save translations**. Until saving, nothing in the workspace is changed. Stopping, closing or a failed request discards the unsaved preview. Generation is bounded to 200 pages and 120 requests; choose smaller sections for a large workspace.

## What stays shared
Page IDs, block IDs, links, database relations, status values, approvals and formulas remain canonical. Text variants translate page titles, prose, text fields, database column/view names and option labels. Formula evaluation, stored filters and ordering keep using the original values. Code blocks with a programming language, inline code, technical identifiers, URLs, attachments and text inside images are not automatically translated.

Translated page text and database views are read-only. Use **Edit original** to change the source, or **Review saved translations** to correct the language variant. Translating a document does not execute instructions, activate agents or run a worker. Agent instructions and reports are separate content; existing agent definitions are not rewritten by a workspace translation.

## Changes, teams and backups
When translatable source text changes, One marks the saved variant as outdated and shows the current original document until reviewed again. Unchanged titles and text fields can still display their matching translation. New pages and new text receive no automatic paid translation.

Variants sync with their page in a team workspace and are retained in workspace backups/imports. Normal share links and document exports publish the canonical original; they do not include the private translation dictionaries. Both languages belong to the same page permissions. Translation is not an access-control boundary.
