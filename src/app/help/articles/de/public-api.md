---
id: public-api
title: Öffentliche API & Webhooks
section: team
order: 5
keywords: api, rest, token, webhook, eingehender webhook, n8n, make, zapier, curl, integration, mcp-server, schnittstelle
related: automations, team-cloud, mcp-bridge
summary: Team-Workspaces lassen sich von deinen Skripten und Automationen lesen und schreiben — mit Tokens und Webhooks.
---
Nur für Team-Workspaces auf einem One-Server. **Workspace-Einstellungen → Automatisierung → API & Webhooks** (Inhaber und Admins).

## API-Tokens
1. **Name des Tokens** (z. B. *Zapier – CRM-Sync*) und **Zugriff**: **Nur lesen** oder **Lesen & schreiben**.
2. **Token erstellen** — **nur einmal sichtbar**: jetzt kopieren. Der Server speichert nur einen Fingerabdruck; verlorene Tokens widerrufst und ersetzt du.
3. **Mit curl testen** zeigt ein fertiges Beispiel.

Die REST-API (`/api/v1`) listet Datenbanken, liest, legt an und ändert Einträge und Seiten. Referenz: [docs/API.md](https://github.com/MarcelWeissgerberIT/SimpleCMS/blob/main/docs/API.md) (englisch).

## Eingehende Webhooks
**Webhook erstellen** für eine Datenbank: Was an ihre URL gePOSTet wird — JSON oder Formularfelder — wird ein Eintrag; Felder passen über die Eigenschaftsnamen. Das Geheimnis steckt in der URL, nur einmal sichtbar; **Neue URL** ersetzt sie.

## MCP für Agenten
Der Server bietet außerdem einen MCP-Endpunkt unter `https://<dein Server>/mcp` für Claude Code, Cursor und andere Clients, mit denselben API-Tokens. Details: `docs/MCP.md`.

> Private Seiten sind über API, Webhooks und MCP nie erreichbar.
