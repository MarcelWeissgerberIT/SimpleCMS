---
id: agent
title: The AI terminal
section: ai
order: 3
keywords: agent, ai terminal, terminal, claude, automate, bulk, tasks, rows, pages, databases, board, workspace agent, apply, review, keyboard, commands, references, context, what claude reads, redo, KI-Terminal, Agent, Aufgaben, automatisieren, Kontext
related: custom-agents, ai-menu, mcp-servers, mcp-bridge
summary: Give Claude tasks by keyboard — it reads your workspace, proposes changes, and you apply them. Keeps working while hidden.
---
Press <kbd>Mod+J</kbd> (or ⌘K → *AI terminal*, or **AI** in the status bar). The terminal docks under the page — the sidebar stays — and on a phone it fills the screen.

1. Type a task, e.g. *“Turn this week's meeting notes into action items in Projects”* or *“Make a board of the open items on this page”*, and press <kbd>Enter</kbd> (<kbd>Shift+Enter</kbd> for a new line).
2. Claude searches and reads your pages and databases; the answer streams in, and every tool call is one line in the log (`→ search_pages "Delta"`, `✓ create_row … staged #2`).
3. Changes are **proposed**, not written: new pages, rows, databases and properties, changed values and titles land in a review list. Apply them one by one, **Apply all** (<kbd>Mod+Enter</kbd> or `/apply`) or discard them. One **Undo** reverts an applied batch.

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
- `/new` starts over · `/stop` · `/apply` · `/discard` · `/history` · `/mcp` (servers in use) · `/cost` (tokens and estimated cost) · `/context` (what Claude reads on the open page) · `/redo` (redo passages with instructions) · `/help`. German names work too: `/neu`, `/stopp`, `/übernehmen`, `/verwerfen`, `/verlauf`, `/kosten`, `/kontext`, `/neu-machen`, `/hilfe`.

## Good to know
- Claude can create databases (a table or a board grouped by a column) and add properties, then fill them with rows in the same task. Locked databases refuse new properties.
- A task ends at a limit of tool calls; Claude is asked to wrap up. MCP servers you added are available to it.
- The meter shows tokens and an estimated cost (billed by Anthropic to your key). Nothing changes until you apply; in a team workspace, viewers see proposals but cannot apply them.
