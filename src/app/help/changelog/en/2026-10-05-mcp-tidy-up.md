---
id: 2026-10-05-mcp-tidy-up
date: 2026-10-05
order: 3
title: Claude Desktop tidies up your workspace
summary: Through One's MCP, Claude can now trash and restore, move pages and rows, and reshape properties and views — nothing is deleted for good.
image: assets/shots/changelog/mcp-tidy-up.webp
alt: An approval card in One: Claude Desktop wants to move the database “Projects” with its rows to the trash
help: mcp-bridge, mcp-servers
try: settings-mcp
---
Claude Desktop, Claude Code and other MCP clients can now reorganise, not just read and write: move pages and databases in the tree, move a row into another database whose properties fit, rename databases, change properties and views, and trash pages, rows and whole databases — up to 50 at once — or restore them.

- **Nothing is deleted for good.** A database goes to the trash with its rows, and every change can be undone under **Agent activity**.
- **You decide.** With *Ask first*, each change waits on a card in your tab — it says what goes, e.g. *Database “Projects” with 8 rows → trash*. A locked database refuses structure changes.
- **The codeword `one:`** — *“one: tidy up my Projects database”* — tells Claude to use One for the request.

> Update needed: in Claude Desktop install the new extension (**Settings → Agents · MCP → Add to Claude Desktop**); for Claude Code download `one-mcp.mjs` again.
