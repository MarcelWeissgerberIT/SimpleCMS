---
id: agent
title: The AI terminal
section: ai
order: 3
keywords: agent, ai terminal, terminal, claude, automate, bulk, tasks, rows, pages, databases, board, workspace agent, apply, review, keyboard, commands, references, context, what claude reads, redo, edit, replace, rewrite, diff, sub-page per item, page per ticket, table of links, limit, continue, pipelines, coding task, approve, connect, sign in, mcp, KI-Terminal, Agent, Aufgaben, automatisieren, Kontext, ändern, ersetzen, Unterseite pro Ticket, weiter, verbinden, anmelden
related: custom-agents, ai-menu, mcp-servers, mcp-bridge, coding-pipeline, pipelines
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

## Coding pipelines from the terminal
When you use the [coding pipelines](help:coding-pipeline), Claude can read them — what waits for you, a task's stage, its plan, test result and log — and **propose** what you ask for: a new task (Coding, Business analysis or QA), or an action on one: approve, send back with a note, answer its question, run it once, stop it, set *Then* or hand it on.

- Every such change is a proposal in the review, like the rest. A new task shows **all** of it: project, repo, branch, where it starts and stops, its whole page exactly as Claude Code will read it (scroll the box) and the pages that go along. An approval shows the plan it approves and what runs on its own after it.
- Proposals that **start the worker** on your computer carry **STARTS WORKER** and are never part of *Apply all* (<kbd>a</kbd>, `/apply`, <kbd>Mod+Enter</kbd>): apply each with <kbd>Enter</kbd> on it.
- A task written or changed elsewhere (another device, or an agent) shows **CONFIRM FIRST**: applying is refused until you press **Confirm on this device** on the task page — the terminal never confirms a task for you.
- A task that moved, changed or got a new question after Claude proposed the action is refused (*changed since — ask again*). Undo leaves an applied task action in place: the worker may have started.
- `/pipelines` (or `/pipelines qa`) lists the open tasks — what waits for you first — with **Open** and, for a running one, **Stop**.
- Claude can't move a task to any stage, change Repo or Branch of a task, confirm it, change approvals, run git commands or edit the pipeline.

## Connect an MCP server
`/connect` lists your [MCP servers](help:mcp-servers) and how they stand. `/connect atlas` (a name, a codeword like `kb:` or an address) signs in — the sign-in window opens right from your <kbd>Enter</kbd> — or only tests the server when its token works. `/connect https://…` adds a new server first. When a task fails because a server rejected its token, **Sign in to <server>** sits under it (or press <kbd>Enter</kbd> on the empty prompt); once connected, **Run the task again** (<kbd>Enter</kbd>) runs it with the new sign-in.

## It keeps working
Hide the terminal with <kbd>Esc</kbd> or <kbd>Mod+J</kbd> and go on working — the task runs on. The status bar shows **AI · working** and then **AI · 3 changes to review**; a toast tells you when it is done, and a click brings the terminal back. Only **Stop** ends a task: <kbd>Mod+.</kbd>, <kbd>Ctrl+C</kbd> (with nothing selected), `/stop` or the Stop key. Proposals so far stay.

## Context
- The **open page** goes along as a chip — remove it with × if the task is not about it.
- **References:** select text in a page and press **Add to terminal** in the toolbar or <kbd>Mod+Shift+J</kbd> (also in read-only pages and database rows). The passage becomes a chip; up to 10 go along with the next task as Markdown with their page, then move into that task's log line. <kbd>Backspace</kbd> at the start of the prompt removes the last chip.
- **Mentions:** type `@` and part of a title, then <kbd>Tab</kbd>: the page or database becomes context. `one:` lists the pages and entries on the level of the open page first (then a title search); `<codeword>:` at the start (e.g. `kb:`) lists that [MCP server's](help:mcp-servers) tools — pick one and Claude uses it.

## What Claude reads
The open page's chip says how much of it Claude may read: just the title for the whole page, *· 3 blocks* when you marked blocks, *· nothing* when you left it out. Click the chip for **Whole page**, **Only marked blocks**, **Mark blocks…** (or `/context`) and **Nothing from this page** — the same marks as in the [AI menu](help:ai-menu). Then `read_page` (and search) return only the marked blocks of that page, or withhold it, and Claude is told so; writing to it works as before, with your review. Other pages are not affected; references still send exactly the text you selected. `/redo` marks passages of the open page to redo with instructions.

## Keys and commands
- <kbd>↑</kbd> / <kbd>↓</kbd> on the first / last line: earlier prompts (the last 50 on this device and workspace, never synced).
- <kbd>Tab</kbd> completes `/commands`, `@` mentions, `one:` and a codeword's tools; on an empty prompt it moves into the review list.
- <kbd>Enter</kbd> on the empty prompt: **Continue** a task stopped at the limit, **sign in** to a server that rejected its token, or **run the task again** after that sign-in.
- In the review list: <kbd>j</kbd> / <kbd>k</kbd> (or arrows) move, <kbd>Space</kbd> marks, <kbd>Enter</kbd> applies the marked (or the current) entry, <kbd>a</kbd> applies all (not those that start the coding worker), <kbd>d</kbd> discards, <kbd>o</kbd> opens the page, <kbd>u</kbd> undoes the last apply, <kbd>Esc</kbd> goes back to the prompt.
- <kbd>Alt+↑</kbd> / <kbd>Alt+↓</kbd> or dragging the top edge change the height; the maximise key fills the content area.
- `/new` (or `/clear`) starts over · `/stop` · `/continue` (a task that stopped at the limit goes on) · `/apply` · `/discard` · `/history` · `/clear-history` (forgets this device's prompts of the workspace — after a *y / n*) · `/mcp` (servers in use) · `/pipelines` (open pipeline tasks) · `/connect` (sign in to or test an MCP server, add one) · `/cost` (tokens and estimated cost) · `/context` (what Claude reads on the open page) · `/redo` (redo passages with instructions) · `/remember <sentence>`, `/no-memory`, `/example <tag>` ([One memory](help:memory)) · `/help`. German names work too: `/neu` (`/leeren`), `/stopp`, `/weiter`, `/übernehmen`, `/verwerfen`, `/verlauf`, `/verlauf-leeren`, `/verbinden`, `/kosten`, `/kontext`, `/neu-machen`, `/merken`, `/ohne-gedächtnis`, `/beispiel`, `/hilfe`.

## Good to know
- Claude can create databases (a table or a board grouped by a column) and add properties, then fill them with rows in the same task. Locked databases refuse new properties.
- A task has a budget of 40 tool calls (the calls of MCP servers don't count). At the limit Claude wraps up and the task shows **Limit reached** with a **Continue** key — or press <kbd>Enter</kbd> on the empty prompt, or type `/continue`: the same task goes on with a fresh budget, in the same conversation; what is staged stays and is not staged twice. MCP servers you added are available to it.
- The meter shows tokens and an estimated cost (billed by Anthropic to your key). Nothing changes until you apply; in a team workspace, viewers see proposals but cannot apply them.
- The [One memory](help:memory) goes along with every task (**MEMORY · 3** in the head), and after a task Claude may propose what to remember — saved only with your OK. `#tag` takes a saved example along in full.
