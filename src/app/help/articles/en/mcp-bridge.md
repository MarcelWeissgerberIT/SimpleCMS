---
id: mcp-bridge
title: Claude Desktop & local MCP
section: ai
order: 6
keywords: mcp, claude desktop, claude code, cursor, bridge, mcpb, extension, agent, local, one-mcp, Brücke, Erweiterung
related: mcp-servers, agent, team-cloud
summary: Let Claude Desktop, Claude Code or any MCP client work in your open One tab.
---
**Settings → Agents · MCP.** A small bridge on your computer connects the MCP client to this tab — your workspace stays in the browser.

## Claude Desktop — one click
1. **Add to Claude Desktop** downloads `one.mcpb` (macOS, Windows). Open it — Claude Desktop asks to install the extension. No terminal, no Node.js.
2. Back in One, switch on **Allow AI agents on this computer**.
3. Ask Claude Desktop: *“What is in my One workspace?”*

If the browser asks whether One may reach apps on this device (“Local network access”), choose **Allow**. Safari does not let an https page talk to the bridge — use Chrome, Edge or Firefox.

## Claude Code, Cursor, VS Code …
**Other clients · manual setup** (needs Node.js 20 or newer): download the bridge file `one-mcp.mjs` to your home folder, then for Claude Code:
```
claude mcp add one -- node ~/one-mcp.mjs
```

## What agents may do
- **Ask first** — every change waits for your OK on a card in this tab (2 minutes, then it is refused). Reading needs no OK.
- **Apply directly** — changes are written at once and listed in **Agent activity**, where each can be undone.
- **Read only** — every change is refused.

The newest tab of a workspace wins the bridge. The default port is 47321 (`ONE_MCP_PORT` to change it). Details: `docs/MCP.md` in the repository.
