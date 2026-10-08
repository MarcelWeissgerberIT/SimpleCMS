---
id: 2026-10-08-mcp-overview
date: 2026-10-08
order: 3
title: One table for your MCP servers — codeword and where each may be used
summary: Settings → Claude AI → MCP servers opens with an overview — per server its codeword, which of One's Claude requests take it, the agents and integrations that use it, and whether Claude Code in the worker has it.
image: assets/shots/changelog/mcp-overview.webp
alt: The overview table with the rows TRACKER (codeword kb:, Every AI call, the agents Daily digest with 2 tools and Triage, the integration Item tracker, Claude Code in the repo website), WIKI switched off and notes, a server only Claude Code has
help: mcp-servers
try: settings-ai
---
**Settings → Claude AI → MCP servers** now starts with a table: one row per server.

- **Codeword** — the `kb:` a request can start with to address the server first.
- **One's Claude** — *Agent, own requests, ⌘K*, *Every AI call*, or *Off* (then not even its codeword reaches it).
- **Custom agents** — the agents that attach it; a tool list shows how many tools they may use, a switched-off agent is struck through.
- **Integrations** — the integration profiles this server makes active (shown once you have one).
- **Claude Code (worker)** — the repos (and *tasks without a repo*) where Claude Code in the coding worker has a server of the same name or codeword. A server only Claude Code has gets a row of its own.

Click a server's name to open its settings below. At phone width every server is a card.

> The Claude Code column needs the newest worker — download it again from #/coding.
