---
id: 2026-10-06-pages-per-item
date: 2026-10-06
order: 6
title: A sub-page for every item
summary: One page per ticket, linked in a table on the main page — from the AI terminal in one step, or from a list, headings or a table without AI.
image: assets/shots/changelog/pages-per-item.webp
alt: A page with a table linking twelve ticket sub-pages, which show in the sidebar under it; below, the AI terminal's log with one Atlas lookup, one call for all pages and the table
help: agent, ai-menu, block-handle
try: terminal
---
Ask the [AI terminal](help:agent) for *“a sub-page for every ticket, linked in a table on this page”* — the tickets can come from your tracker over MCP. Claude stages all pages in one call and the table with a link to each, plus status, owner or date as columns. After **Apply all** every link opens its page.

- **Continue:** a long task that reaches the tool-call limit stops as **Limit reached**. **Continue** — or <kbd>Enter</kbd> on the empty prompt, `/continue`, `/weiter` — picks it up with a fresh budget; nothing is staged twice.
- **Sub-page per item**, no Claude: select a list, a few headings with text below them or a table → **Turn into → Sub-page per item** (or **Ask AI → Structure**, **Transform into → Pages + table**). One <kbd>Mod+Z</kbd> takes it back.
- **Say it in the AI menu:** *“make a sub-page out of this”*, *“für jeden Punkt eine Unterseite”* or *“als Tabelle”* now run the matching action; work beyond the selection opens the AI terminal with your request.
