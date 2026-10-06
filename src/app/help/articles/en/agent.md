---
id: agent
title: The AI terminal
section: ai
order: 3
keywords: agent, ai terminal, terminal, claude, automate, bulk, tasks, rows, pages, databases, board, workspace agent, apply, review, keyboard, commands, references, context, what claude reads, redo, edit, replace, rewrite, diff, sub-page per item, page per ticket, table of links, limit, continue, KI-Terminal, Agent, Aufgaben, automatisieren, Kontext, ändern, ersetzen, Unterseite pro Ticket, weiter
related: custom-agents, ai-menu, mcp-servers, mcp-bridge
summary: Give Claude tasks by keyboard — it reads your workspace, proposes changes, and you apply them. Keeps working while hidden.
---
Press <kbd>Mod+J</kbd> (or ⌘K → *AI terminal*, or **AI** in the status bar). The terminal docks under the page — the sidebar stays — and on a phone it fills the screen.

1. Type a task, e.g. *“Turn this week's meeting notes into action items in Projects”* or *“Make a board of the open items on this page”*, and press <kbd>Enter</kbd> (<kbd>Shift+Enter</kbd> for a new line).
2. Claude searches and reads your pages and databases; the answer streams in, and every tool call is one line in the log (`→ search_pages "Delta"`, `✓ create_row … staged #2`).
3. Changes are **proposed**, not written: new pages, rows, databases and properties, changed values and titles land in a review list. Apply them one by one, **Apply all** (<kbd>Mod+Enter</kbd> or `/apply`) or discard them. One **Undo** reverts an applied batch.

## A page for every item
Ask for *“a sub-page for every ticket, linked in a table on this page”* — the tickets may come from the page, a database or an [MCP server](help:mcp-servers) like your tracker. Claude stages all the pages in one step (up to 50 per call, each its own proposal in the review), then a table on the main page — the open page when you say *this page* or *main page* — with a link to every page and the items' key fields (status, owner, date …) as columns. After **Apply all** the links are page mentions: a click opens the sub-page. When the items share fields and you ask for a table or tracker instead, Claude makes a [database](help:databases) with a row per item.

## Changing existing text
Claude adds to a page with *append*. When a task asks to **fix, rewrite, update or remove** what is there, it changes exactly those blocks instead: it reads the page with a short label per block (`b3`) and names the blocks it changes — replace, delete, insert after, or rewrite the whole page when you ask for that. Every edit is one proposal, shown as a **diff** of the page: removed words struck through on red, new words on orange, unchanged blocks folded (*12 unchanged blocks — show*).

- Apply or discard each edit on its own. The edits of one page you apply together go in as one step: a version is kept first (**AI** in the [version history](help:history)), and <kbd>Mod+Z</kbd> in the open page takes the whole edit back.
- A block you changed after Claude proposed the edit is **skipped**, never overwritten — the review says so.
- Blocks you left out of what Claude reads (see below) can't be changed either, and a full rewrite of such a page is refused.
- [Custom agents](help:custom-agents) can propose edits too; even an agent that writes directly waits for your OK before it replaces text.

## It keeps working
Hide the terminal with <kbd>Esc</kbd> or <kbd>Mod+J</kbd> and go on working — the task runs on. The status bar shows **AI · working** and then **AI · 3 changes to review**; a toast tells you when it is done, and a click brings the terminal back. Only **Stop** ends a task: <kbd>Mod+.</kbd>, <kbd>Ctrl+C</kbd> (with nothing selected), `/stop` or the Stop key. Proposals so far stay.

## Context
- The **open page** goes along as a chip — remove it with × if the task is not about it.
- **References:** select text in a page and press **Add to terminal** in the toolbar or <kbd>Mod+Shift+J</kbd> (also in read-only pages and database rows). The passage becomes a chip; up to 10 go along with the next task as Markdown with their page, then move into that task's log line. <kbd>Backspace</kbd> at the start of the prompt removes the last chip.
- **Mentions:** type `@` and part of a title, then <kbd>Tab</kbd>: the page or database becomes context.

## What Claude reads
The open page's chip says how much of it Claude may read: just the title for the whole page, *· 3 blocks* when you marked blocks, *· nothing* when you left it out. Click the chip for **Whole page**, **Only marked blocks**, **Mark blocks…** (or `/context`) and **Nothing from this page** — the same marks as in the [AI menu](help:ai-menu). Then `read_page` (and search) return only the marked blocks of that page, or withhold it, and Claude is told so; writing to it works as before, with your review. Other pages are not affected; references still send exactly the text you selected. `/redo` marks passages of the open page to redo with instructions.

## Keys and commands
- <kbd>↑</kbd> / <kbd>↓</kbd> on the first / last line: earlier prompts (the last 50 on this device and workspace, never synced).
- <kbd>Tab</kbd> completes `/commands` and `@` mentions; on an empty prompt it moves into the review list.
- In the review list: <kbd>j</kbd> / <kbd>k</kbd> (or arrows) move, <kbd>Space</kbd> marks, <kbd>Enter</kbd> applies the marked (or the current) entry, <kbd>a</kbd> applies all, <kbd>d</kbd> discards, <kbd>o</kbd> opens the page, <kbd>u</kbd> undoes the last apply, <kbd>Esc</kbd> goes back to the prompt.
- <kbd>Alt+↑</kbd> / <kbd>Alt+↓</kbd> or dragging the top edge change the height; the maximise key fills the content area.
- `/new` (or `/clear`) starts over · `/stop` · `/continue` (a task that stopped at the limit goes on) · `/apply` · `/discard` · `/history` · `/clear-history` (forgets this device's prompts of the workspace — after a *y / n*) · `/mcp` (servers in use) · `/cost` (tokens and estimated cost) · `/context` (what Claude reads on the open page) · `/redo` (redo passages with instructions) · `/remember <sentence>`, `/no-memory`, `/example <tag>` ([One memory](help:memory)) · `/help`. German names work too: `/neu` (`/leeren`), `/stopp`, `/weiter`, `/übernehmen`, `/verwerfen`, `/verlauf`, `/verlauf-leeren`, `/kosten`, `/kontext`, `/neu-machen`, `/merken`, `/ohne-gedächtnis`, `/beispiel`, `/hilfe`.

## Good to know
- Claude can create databases (a table or a board grouped by a column) and add properties, then fill them with rows in the same task. Locked databases refuse new properties.
- A task has a budget of 40 tool calls (the calls of MCP servers don't count). At the limit Claude wraps up and the task shows **Limit reached** with a **Continue** key — or press <kbd>Enter</kbd> on the empty prompt, or type `/continue`: the same task goes on with a fresh budget, in the same conversation; what is staged stays and is not staged twice. MCP servers you added are available to it.
- The meter shows tokens and an estimated cost (billed by Anthropic to your key). Nothing changes until you apply; in a team workspace, viewers see proposals but cannot apply them.
- The [One memory](help:memory) goes along with every task (**MEMORY · 3** in the head), and after a task Claude may propose what to remember — saved only with your OK. `#tag` takes a saved example along in full.
