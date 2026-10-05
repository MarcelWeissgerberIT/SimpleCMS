---
id: ai-menu
title: The AI menu & asking
section: ai
order: 2
keywords: ai, claude, space, ask ai, improve, summarize, translate, explain, continue writing, action items, ask workspace, turn into database, board, table, background, KI, Leertaste, verbessern, zusammenfassen, übersetzen, Datenbank
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

## Turn into database
Select a list, a table or a report of several blocks → **Ask AI** → **Turn into database**. Claude reads the blocks and proposes a table: the entries with their fields (status, assignee, tags, reference codes …), grouped by the headings they were listed under. The preview shows the counts, the columns (switch off what you don't want), **Group by**, **Board** or **Table**, the first entries and what stays as text — introductions and notes keep their original formatting and links. **Convert** (<kbd>Enter</kbd>) puts the database where the list was; <kbd>Mod+Z</kbd> brings the text back in one step (the toast's **Undo** also removes the database). Nothing is invented: a value the text doesn't state stays empty.

## Keeps running in the background
A request keeps going when you close the panel, click in the sidebar or open another page — only **Stop** and **Discard** end it. The page shows it at its foot (**AI · Writing…**, then **AI result ready · View**), the sidebar marks the page with a dot, and a toast with **Open** tells you when a result is ready elsewhere. If the text changed meanwhile, One finds it again; when it is gone, **Replace** is off and **Insert below** goes to the end of the page. Results wait on this device (also after a reload) until you accept or discard them — for 7 days at most, never synced.

## ⌘K, then ?
Type `?` in the command palette to ask Claude about the open page. Append the answer to the page, make it a new page, or copy it.

> Requests go from your browser to Anthropic with your key. MCP servers you added can join free-form requests — see [MCP servers](help:mcp-servers).
