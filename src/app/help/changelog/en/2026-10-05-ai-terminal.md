---
id: 2026-10-05-ai-terminal
date: 2026-10-05
order: 15
title: The AI terminal
summary: Give Claude a task by keyboard — it docks under the page, keeps working while hidden and waits for your review.
image: assets/shots/changelog/ai-terminal.webp
alt: The AI terminal under a page: the task, Claude's step log and a new board with its rows waiting for review
help: agent, ai-menu, mcp-servers
try: terminal
---
Press <kbd>Mod+J</kbd> and type a task in plain words — *“Make a board of the open items on this page”*. The terminal docks under the page, the sidebar stays. Claude reads your pages and databases, shows every step as one log line and **proposes** the changes: new pages, rows, databases and properties land in a review list. Nothing is written before you apply.

- **Review by keyboard:** <kbd>j</kbd> / <kbd>k</kbd> move, <kbd>Space</kbd> marks, <kbd>Enter</kbd> applies, <kbd>a</kbd> applies all, <kbd>d</kbd> discards. One **Undo** takes a whole batch back.
- **Keeps working:** hide it with <kbd>Esc</kbd> — the status bar LED shows *AI · working*, a toast says when it is done.
- **References:** select text, then **Add to terminal** or <kbd>Mod+Shift+J</kbd>. Type `@` to add a page or database as context.
- **Commands:** `/apply`, `/stop`, `/cost`, `/help` — in German too: `/übernehmen`, `/hilfe`.

> Tip: <kbd>↑</kbd> on the first line brings back your earlier tasks — the last 50, on this device.
