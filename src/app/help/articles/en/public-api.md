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
1. **Token name** (e.g. *Zapier — CRM sync*) and **Access**: **Read only** or **Read & write**.
2. **Create token** — **shown once**: copy it now. The server keeps only a fingerprint; lost tokens are revoked and replaced.
3. **Try it with curl** shows a ready example.

The REST API (`/api/v1`) lists databases, reads, creates and updates rows and pages. Reference: [docs/API.md](https://github.com/MarcelWeissgerberIT/SimpleCMS/blob/main/docs/API.md).

## Incoming webhooks
**Create webhook** for a database: whatever is POSTed to its URL — JSON or form fields — becomes a row; fields match property names. The secret is part of the URL, shown once; **New URL** replaces it.

## MCP for agents
The server also offers an MCP endpoint at `https://<your server>/mcp` for Claude Code, Cursor and other clients, using the same API tokens. Details: `docs/MCP.md`.

> Private pages are never reachable through the API, webhooks or MCP.
