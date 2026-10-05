---
id: ai-menu
title: The AI menu & asking
section: ai
order: 2
keywords: ai, claude, space, ask ai, improve, summarize, translate, explain, continue writing, action items, ask workspace, turn into database, board, table, background, context, what claude reads, mark blocks, redo, rewrite, instructions, presets, style guide, KI, Leertaste, verbessern, zusammenfassen, übersetzen, Datenbank, Kontext, neu machen, Vorgaben
related: claude-key, agent, command-palette, history
summary: Space on an empty line, or Ask AI on a selection — Claude writes, edits and answers right in the page.
---
## On an empty line: Space
Press <kbd>Space</kbd> on an empty line (or `/ai`). Type any request, or pick:
- **Write** — **Continue writing**, **Draft an outline…**, **Brainstorm ideas…**
- **This page** — **Summarize this page**, **Find action items on this page**
- **Workspace** — **Ask your workspace**: Claude reads the most relevant pages of this workspace and cites them; only those excerpts are sent.

## On a selection: Ask AI
Select text → **Ask AI** in the toolbar. **Edit selection**: **Improve writing**, **Fix spelling & grammar**, **Make shorter**, **Make longer**, **Translate**. **Understand**: **Explain this**, **Summarize**, **Find action items**.

The answer streams in. Then **Replace selection** (or **Insert below**), **Revise** with a follow-up instruction, **Try again**, **Copy** or **Discard**. Before Claude changes a page, a version is saved — see [Version history](help:history).

## What Claude reads
Under the prompt one line says what goes to Claude from this page: **Reads · whole page · 1,204 words**, **3 marked blocks · 412 words** or **nothing from this page** — plus **selection** for actions on selected text (the selection is always read). Click the line (or type *context*) to choose **Whole page**, **Only marked blocks**, **Mark blocks…** or **Nothing from this page**.

**Mark blocks…** puts a box next to every block and pauses typing: a click or <kbd>Space</kbd> marks, <kbd>Shift</kbd>-click marks a range, <kbd>j</kbd> / <kbd>k</kbd> (or arrows) move, <kbd>a</kbd> all, <kbd>n</kbd> none, <kbd>Enter</kbd> done, <kbd>Esc</kbd> cancels. The panel comes back with your request. Marked blocks go out as Markdown (links and mentions stay readable); unmarked text is never sent. With nothing to read, **Continue writing** and **Summarize this page** ask first instead of sending. Marks belong to this tab: they follow your edits and are never saved or synced. The [AI terminal](help:agent) keeps to them too.

## Turn into database
Select a list, a table or a report of several blocks → **Ask AI** → **Turn into database**. Claude reads the blocks and proposes a table: the entries with their fields (status, assignee, tags, reference codes …), grouped by the headings they were listed under. The preview shows the counts, the columns (switch off what you don't want), **Group by**, **Board** or **Table**, the first entries and what stays as text — introductions and notes keep their original formatting and links. **Convert** (<kbd>Enter</kbd>) puts the database where the list was; <kbd>Mod+Z</kbd> brings the text back in one step (the toast's **Undo** also removes the database). Nothing is invented: a value the text doesn't state stays empty.

## Redo with instructions
Mark passages and have Claude rework them your way: **Ask AI** → **Redo with instructions…** (also in the block menu ⋮⋮, or `/redo` in the AI terminal). The picker opens with the selected blocks marked — mark more, even far apart (whole blocks), then <kbd>Enter</kbd>. Write what should change — *shorter, informal, explain the jargon* — and keep it as a preset chip for next time (up to 20, on this device; **⋯** renames or deletes). Optionally add a **rules page** (`@` in the field): a style guide or glossary whose content goes along. **Redo** (<kbd>Mod+Enter</kbd>) runs in the background like any request; the page goes along as **What Claude reads** allows.

The review shows one passage at a time — removed words struck through, new ones underlined: <kbd>y</kbd> or <kbd>Enter</kbd> accepts, <kbd>n</kbd> rejects, <kbd>j</kbd> / <kbd>k</kbd> move, <kbd>a</kbd> accepts all, <kbd>Esc</kbd> closes (the result waits). Applying writes every accepted passage in one step — one <kbd>Mod+Z</kbd> takes it back, and a version is saved first. Formatting, links and mentions stay. A passage you changed meanwhile is skipped, not overwritten; images, databases, embeds and other blocks without text are skipped too.

## Keeps running in the background
A request keeps going when you close the panel, click in the sidebar or open another page — only **Stop** and **Discard** end it. The page shows it at its foot (**AI · Writing…**, then **AI result ready · View**), the sidebar marks the page with a dot, and a toast with **Open** tells you when a result is ready elsewhere. If the text changed meanwhile, One finds it again; when it is gone, **Replace** is off and **Insert below** goes to the end of the page. Results wait on this device (also after a reload) until you accept or discard them — for 7 days at most, never synced.

## ⌘K, then ?
Type `?` in the command palette to ask Claude about the open page. Append the answer to the page, make it a new page, or copy it.

> Requests go from your browser to Anthropic with your key. MCP servers you added can join free-form requests — see [MCP servers](help:mcp-servers).
