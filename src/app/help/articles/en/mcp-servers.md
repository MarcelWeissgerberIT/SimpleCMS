---
id: mcp-servers
title: MCP servers (knowledge bases & co)
section: ai
order: 6
keywords: mcp, mcp server, tools, connector, knowledge base, token, external tools, integration, MCP-Server, Werkzeuge, Wissensdatenbank
related: agent, ai-menu, mcp-token-rejected, mcp-bridge, claude-key
summary: Let One's Claude use the tools of other systems — a knowledge base, a tracker, a CRM.
---
**Settings → Claude AI → MCP servers.** You need [your Claude key](help:claude-key) first.

## Add a server (a knowledge base as example)
1. In your knowledge base, copy its MCP server address (`https://…/mcp`) and create a token for One — read-only, limited to the projects you need, if it lets you choose.
2. In One: **Add server**, paste the **Server URL** and the **Token**, **Save**.
3. One names the server after its address, switches it on and checks it in the background: it tests the connection, lists the tools Claude sees and writes a **Usage prompt** that tells Claude which tool is for what. The LED turns to **Connected**.

## Where it is used
**Details** → **Used in**:
- **Agent, own requests and ⌘K ask** (default) — the agent, your own requests in the AI menu, and `?` in ⌘K.
- **All AI calls** — also the one-click actions, database autofill and meeting summaries. Each of those requests gets longer and slower.

**Details** also holds the name, the token, the usage prompt (**Generate** / **Regenerate**, or write your own), **Test connection** and **Remove server**. While Claude works, MCP calls show as small chips, e.g. `KB · search`.

## How it works — and the token
Requests go to `api.anthropic.com`; Anthropic connects to the server while Claude answers. So only remote servers reachable over HTTPS work (Streamable HTTP or SSE) — no local ones, and no servers that only offer an interactive sign-in (OAuth).

> The token is sent to Anthropic with every request that uses the server, and stored sealed in this browser — never in backups, exports or sync. Use a dedicated token for One, read-only where possible. On another device, add the token again.
