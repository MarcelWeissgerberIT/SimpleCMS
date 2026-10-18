---
id: public-api
title: Public API & webhooks
section: team
order: 5
keywords: api, rest, token, webhook, incoming webhook, n8n, make, zapier, curl, integration, mcp server, API, Webhook, Token, Schnittstelle
related: automations, team-cloud, mcp-bridge
summary: Team workspaces can be read and written by your scripts and automations — with tokens and webhooks.
---
Only for team workspaces on a One server. **Workspace settings → Automation → API & webhooks** (owners and admins).

## API tokens
1. **Token name** (e.g. *Zapier — CRM sync*), **Access**: **Read only** or **Read & write**, and **Comments (MCP)**: whether an MCP client with this token may read comments (off by default).
2. **Create token** — **shown once**: copy it now. The server keeps only a fingerprint; lost tokens are revoked and replaced.
3. **Try it with curl** shows a ready example.

The REST API (`/api/v1`) lists databases, reads, creates and updates rows and pages. Reference: [docs/API.md](https://github.com/MarcelWeissgerberIT/SimpleCMS/blob/main/docs/API.md).

## Incoming webhooks
**Create webhook** for a database: whatever is POSTed to its URL — JSON or form fields — becomes a row; fields match property names. The secret is part of the URL, shown once; **New URL** replaces it.

## MCP for agents
The server also offers an MCP endpoint at `https://<your server>/mcp` for Claude Code, Cursor and other clients, using the same API tokens — pages in full, sub-page trees, boards with their rows and rows in bulk. Details: `docs/MCP.md`.

## Recent MCP writes
The MCP endpoint changes things without asking, so for 14 days the server keeps a copy of what an MCP call made or overwrote: pages, rows and databases it made, row values it changed, a page's text before it was replaced. Property, view, move and trash calls, a new title or icon and plain additions to a page keep no copy and are not listed — undo those in One (page history, the trash). **Recent MCP writes** (owners and admins) lists the calls — which token, what it made and changed — and **Restore** puts one back: what it made goes to the trash and values go back — unless someone changed them since: a page someone wrote into, a row or value changed since stays and is named (then **Restore anyway**); a page or database that stays keeps its link or block in the page the call put it into. A page text changed since the call is only put back when you confirm that the later changes go. A team server that is older says so there in one line: update it to get this list.

> Private pages are never reachable through the API, webhooks or MCP.
