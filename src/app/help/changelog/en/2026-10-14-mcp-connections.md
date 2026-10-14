---
id: 2026-10-14-mcp-connections
date: 2026-10-14
order: 2
title: MCP · Connections — what is connected, on one page
summary: One page lists every MCP connection One knows of — One's own MCP servers, Claude Desktop and Claude Code through this tab, Claude Code in the coding worker, the team server — each with a lamp and the key that fixes it.
image: assets/shots/changelog/mcp-connections.webp
alt: The MCP · Connections page — the readout (One's Claude 3 on · 1 off, needs you 2, bridge connected, worker connected · 1 repo), § 01 One's Claude with nordlicht OK and signed in, tessera token refused with Sign in, archiv test failed and polar off, the line naming a server agents ask for that is not set up, § 02 the bridge connected to Claude Desktop, § 03 the coding worker studio-mac with Claude Code's MCP servers in its repo (nordlicht also One's).
help: mcp-servers, mcp-bridge, mcp-token-rejected
try: mcp
---
**Everything connected, in one place.** ⌘K **MCP** opens **MCP · Connections** (`#/mcp`); **All connections →** in **Settings → Agents · MCP** and **Settings → AI → MCP servers** opens it too.

- **One's Claude** — your MCP servers, each with a lamp: **OK** with its tools, **Test failed**, **Token refused**, **Sign-in ran out**, **Off**. The lamps follow the Preflight Token lamp, so the same servers are red there.
- **Claude Desktop · Code** — whether this tab's bridge is connected, to which client, and what agents may change.
- **Coding worker** — the link to the worker and the MCP servers Claude Code has there, per repo.
- **Team server** — in a team workspace: the workspace's `/mcp` address to copy, and the server agents' MCP servers.

**Fix it in the row.** **Test** checks a connection (one short Claude request), **Sign in** renews a refused one, **Settings ↗** opens exactly that server.

Opening the page sends nothing and opens no token — it shows what One last saw, and each section says whether it belongs to this device, this tab, this browser or the team server. More in [MCP servers](help:mcp-servers).
