---
id: 2026-10-04-mcp-servers
date: 2026-10-04
order: 4
title: MCP servers for One's Claude
summary: Connect a knowledge base, a tracker or a CRM — Claude uses its tools in your own requests and in the agent.
image: assets/shots/changelog/mcp-servers.webp
alt: Settings → Claude AI → MCP servers: a knowledge base, connected, with three tools
help: mcp-servers, mcp-token-rejected, claude-key
try: settings-ai
---
**Settings → Claude AI → MCP servers.** Paste the server's address and a token, **Save** — that's it. One names the server, switches it on and checks it in the background: it lists the tools Claude sees and writes a **usage prompt** that tells Claude which tool is for what. The LED turns to **Connected**.

- From then on, the AI terminal, your own requests in the AI menu and `⌘K ?` can use the server. While Claude works, each call shows as a small chip, e.g. `KB · search`.
- **Used in** decides whether one-click actions and autofill get it too.
- The token is sealed in this browser and goes only to Anthropic with the requests that use the server.

> Tip: create a dedicated token for One, read-only where the service allows it.
