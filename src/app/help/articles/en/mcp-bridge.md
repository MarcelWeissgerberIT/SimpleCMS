---
id: mcp-bridge
title: Claude Desktop & local MCP
section: ai
order: 7
keywords: mcp, mcp connections, script, dry run, two-way, sub-items, dependencies, connected, claude desktop, claude code, cursor, bridge, mcpb, extension, agent, local, one-mcp, codeword, one:, tidy up, trash, restore, move, tasks, one_list_work_items, one_update_work_item, sub-pages, board, rows, batch, upsert, one_list_pages, blocks, comments, Brücke, Erweiterung, Unterseite
related: mcp-servers, agent, team-cloud
summary: Let Claude Desktop, Claude Code or any MCP client work in your open One tab.
---
**Settings → Agents · MCP.** A small bridge on your computer connects the MCP client to this tab — your workspace stays in the browser.

Is it connected? ⌘K **MCP · Connections** shows this tab's bridge next to every other MCP connection — One's own MCP servers, the coding worker, the team server.

## Claude Desktop — one click
1. **Add to Claude Desktop** downloads `one.mcpb` (macOS, Windows). Open it — Claude Desktop asks to install the extension. No terminal, no Node.js.
2. Back in One, switch on **Allow AI agents on this computer**.
3. Ask Claude Desktop: *“What is in my One workspace?”*

**Codeword:** start a message with `one:` — *“one: tidy up my Projects database”* — and Claude uses One for it, not the web or other connectors. Claude Desktop also lists it in the prompt menu (**+** → *One*), Claude Code as `/mcp__one__one`.

If the browser asks whether One may reach apps on this device (“Local network access”), choose **Allow**. If the tab says the browser does not let a secure page talk to the bridge (Safari may), use Chrome, Edge or Firefox.

## Claude Code, Cursor, VS Code …
**Other clients · manual setup** (needs Node.js 20 or newer): save the bridge file `one-mcp.mjs` in your home folder, then for Claude Code:
```
curl -fsSL https://getonecms.com/mcp/one-mcp.mjs -o ~/one-mcp.mjs
claude mcp add one -- node ~/one-mcp.mjs
```
Other MCP clients start it as a stdio server: command `node`, argument the path of `one-mcp.mjs`.

## What agents may do
- **Ask first** — every change waits for your OK on a card in this tab (2 minutes, then it is refused). Reading needs no OK.
- **Apply directly** — changes are written at once and listed in **Agent activity**, where each can be undone.
- **Read only** — every change is refused.

Even with **Apply directly**, a change is asked on a card when it assigns someone, sets a reminder, changes a task someone is assigned to, adds a blocker to a task or removes tasks, or when 5 or more rows at once would start paid AI work or send something out of One — the card says why (**Always asked: …**).

## Sub-pages, boards and rows in one go
One request, one card: an agent can make a **tree of up to 50 sub-pages** (also below a database row), a **board** with its lanes and its cards as a sub-page or inside a page's text, or **change up to 50 rows** at once — *“Create a sub-page with a board Todo / Doing / Done under Project Nordlicht and add these five tasks”* is a search and one card. The card lists every page or row with every value it writes and the first lines of its text (and what a batch would start: autofill, automations, agents); **Undo** in **Agent activity** puts what the call made into the trash, unless someone changed it since. Mirroring items from elsewhere by a key updates only what differs.

Agents also read a page **in full**: every block with its data (databases, files, sheets, charts, meeting notes), long pages in parts. A call repeated within 2 minutes does not make something twice — the agent is told it is already there.

## Comments
Off unless you switch them on: **Comments** in **Settings → Agents · MCP** — **Off**, **Read** or **Read + write**, for this device. With **Read**, agents see a page's comment threads when they ask for them. Writing comments over MCP comes later.

## What agents cannot change
One's own databases — memory, Mails and the mail directories, the coding, analysis and QA pipelines — can be read but not changed over MCP. Templates are invisible to agents. A coding task that takes along a page an agent changed runs only after **Confirm on this device**.

Two-way relations — sub-items and dependencies too — are set in One: agents set one-way relations, but a value of a two-way one (or making a relation two-way) is refused. Your saved scripts only get a dry run over MCP: the agent sees what a script would change and send, nothing happens, and you run it in One (**Scripts**). Agent activity marks such a call *Dry run only*.

## Tasks
Agents read [tasks](help:tasks) in a page as `> [!TODO] Title {#wi_…}` with a field line, and mentions as `[@Alex](one:person/…)` — when they write the text back, both stay. New `[!TODO]` quotes become tasks through the same rules as in One (owners only existing people, ids from One). **one_list_work_items** finds tasks (open, mine, blocked, overdue …); **one_update_work_item** changes status, due date, reminder, owners or links — every task shows on the approval card with its fields before → after. A page that changed while its replace waited for your OK is not replaced: the agent is told to read it again. The task tools need bridge 1.8.0 (download `one.mcpb` again) and work on the local bridge only; the team server gets them later.

## Tidying up
Agents can also reorganise: move pages and databases in the tree, move a row into another database whose properties fit, rename databases, change properties (options, safe type changes) and views, delete properties and views, trash pages, rows and whole databases — up to 50 at once — and restore them. Nothing is deleted for good. A locked database refuses structure changes; locking stays your decision. Each change shows what goes (*Database “Projects” with 8 rows → trash*) and can be undone in **Agent activity**. Bridges from before 1.2.0 don't know these tools: download `one.mcpb` again.

Sub-pages, boards, rows in one go and reading in full need bridge **1.12.0**: when yours is older, **Settings → Agents · MCP** says so — download `one.mcpb` (or `one-mcp.mjs`) again. Until then an agent reads a long page only up to its first 60,000 characters (it is told where the page was cut) and sees only the first 100 sub-pages of a page. After an update of One, reload its tab once, or the bridge refuses the new tools (“reload One”).

The newest tab of a workspace wins the bridge. The default port is 47321 (`ONE_MCP_PORT` to change it). Details: `docs/MCP.md` in the repository.
