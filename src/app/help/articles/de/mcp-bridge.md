---
id: mcp-bridge
title: Claude Desktop & lokales MCP
section: ai
order: 7
keywords: mcp, claude desktop, claude code, cursor, brücke, mcpb, erweiterung, agent, lokal, one-mcp, bridge, extension
related: mcp-servers, agent, team-cloud
summary: Lass Claude Desktop, Claude Code oder jeden MCP-Client in deinem offenen One-Tab arbeiten.
---
**Einstellungen → Agenten · MCP.** Eine kleine Brücke auf deinem Computer verbindet den MCP-Client mit diesem Tab — dein Workspace bleibt im Browser.

## Claude Desktop — ein Klick
1. **Zu Claude Desktop hinzufügen** lädt `one.mcpb` herunter (macOS, Windows). Datei öffnen — Claude Desktop fragt, ob es die Erweiterung installieren soll. Kein Terminal, kein Node.js.
2. Zurück in One: **KI-Agenten auf diesem Computer erlauben** einschalten.
3. Frag Claude Desktop: *„Was steht in meinem One-Workspace?“*

Fragt der Browser, ob One Apps auf diesem Gerät erreichen darf („Zugriff auf lokales Netzwerk“), wähle **Zulassen**. Meldet der Tab, dass der Browser einer sicheren Seite den Kontakt zur Brücke verbietet (Safari kann das), nimm Chrome, Edge oder Firefox.

## Claude Code, Cursor, VS Code …
**Andere Clients · manuelle Einrichtung** (braucht Node.js 20 oder neuer): die Brückendatei `one-mcp.mjs` im Benutzerordner speichern, dann für Claude Code:
```
curl -fsSL https://getonecms.com/mcp/one-mcp.mjs -o ~/one-mcp.mjs
claude mcp add one -- node ~/one-mcp.mjs
```
Andere MCP-Clients starten sie als stdio-Server: Befehl `node`, Argument der Pfad zu `one-mcp.mjs`.

## Was Agenten dürfen
- **Erst fragen** — jede Änderung wartet auf dein OK auf einer Karte in diesem Tab (2 Minuten, dann wird sie abgelehnt). Lesen braucht kein OK.
- **Direkt anwenden** — Änderungen werden sofort geschrieben und im **Agenten-Protokoll** gelistet, wo sich jede rückgängig machen lässt.
- **Nur lesen** — jede Änderung wird abgelehnt.

Der neueste Tab eines Workspace bekommt die Brücke. Standard-Port ist 47321 (`ONE_MCP_PORT` ändert ihn). Details: `docs/MCP.md` im Repository.
