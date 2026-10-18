---
id: 2026-10-17-mcp-boards
date: 2026-10-17
order: 1
title: Claude Desktop and Claude Code — sub-pages, boards and rows in one go
summary: Over MCP, a tree of sub-pages, a board with its lanes and cards, or 50 row changes are one call and one approval card — and agents read a page in full, every block with its data.
image: assets/shots/changelog/mcp-boards.webp
alt: Left, the approval card in One — “Agent · Claude Code”, Create database “Board” in Project Nordlicht, properties Name and Status, views Board by Status and Table, 5 rows each with Status Todo, Reject and Approve; right, the board after Approve under Project Nordlicht, the five tasks in the lane Todo, Doing and Done empty.
help: mcp-bridge, public-api
try: settings-mcp
---
**One request, one card.** Ask Claude Desktop or Claude Code *“Create a sub-page with a board Todo / Doing / Done under Project Nordlicht and add these five tasks”*: it finds the project and asks once. The card names the board, its lanes and every task; **Approve**, and the board is there. **Undo** in **Agent activity** puts it into the trash with its cards.

- **Sub-pages** — up to 50 in one call, as a tree, also below a database row; placed where you want them, linked in the parent's text if you like.
- **Boards and databases** — views, properties and rows in one call, as a sub-page or inside a page's text.
- **Rows in bulk** — create or change up to 50 rows at once, or keep a database in step with items from elsewhere by a key: only what differs changes. A batch of 5 or more rows that would start paid AI work or send something out of One is always asked, also with **Apply directly**.
- **Reading in full** — every block with its data (databases, files, sheets, charts, meeting notes), long pages in parts. Comments only when you switch them on: **Settings → Agents · MCP → Comments**.

One's own databases (memory, Mails, the pipelines) stay read-only over MCP, templates stay invisible, and a call repeated within 2 minutes does not make something twice. This needs bridge **1.12.0**: download `one.mcpb` again, and reload One once after it updated.

On a team server the same tools work at `/mcp`. It changes without a card, so **Recent MCP writes** under **Workspace settings → Automation → API** lists the MCP calls of the last 14 days that made or overwrote something — pages, rows, databases, row values, a replaced page text — with **Restore**. More: [Claude Desktop & local MCP](help:mcp-bridge).
