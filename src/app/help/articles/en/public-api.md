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
The server also offers an MCP endpoint at `https://<your server>/mcp` for Claude Code, Cursor and other clients, using the same API tokens — pages in full, sub-page trees, boards with their rows and rows in bulk. Two-way relations — sub-items and dependencies too — are set in One (or over the REST API), not over MCP; one-way relations work. Details: `docs/MCP.md`.

## Recent MCP writes
The MCP endpoint changes things without asking, so for 14 days the server keeps a copy of what an MCP call made or overwrote: pages, rows and databases it made, row values it changed, a page's text before it was replaced. Property, view, move and trash calls, a new title or icon and plain additions to a page keep no copy and are not listed — undo those in One (page history, the trash). **Recent MCP writes** (owners and admins) lists the calls — which token, what it made and changed — and **Restore** puts one call back as a whole: what it made goes to the trash, values and texts get what they held before. If anything the call made or changed was changed since — a value, a text, a page someone renamed, moved, wrote into or put a page below — nothing is put back, and the row names what changed. Then undo it in One (version history, the trash) or choose **Restore anyway**: it puts back only the texts and values the call changed (the later changes there go) and never trashes anything — what the call made stays and is named, so you can move it to the trash yourself. It never writes into a row or page the call changed that went to the trash or was moved since. A call that only made pages or rows has nothing Restore anyway could put back. A team server that is older says so there in one line: update it to get this list.

> Private pages are never reachable through the API, webhooks or MCP.
