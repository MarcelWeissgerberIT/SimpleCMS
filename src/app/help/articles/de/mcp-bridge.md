---
id: mcp-bridge
title: Claude Desktop & lokales MCP
section: ai
order: 7
keywords: mcp, claude desktop, claude code, cursor, brücke, mcpb, erweiterung, agent, lokal, one-mcp, codewort, one:, aufräumen, papierkorb, wiederherstellen, verschieben, bridge, extension
related: mcp-servers, agent, team-cloud
summary: Lass Claude Desktop, Claude Code oder jeden MCP-Client in deinem offenen One-Tab arbeiten.
---
**Einstellungen → Agenten · MCP.** Eine kleine Brücke auf deinem Computer verbindet den MCP-Client mit diesem Tab — dein Workspace bleibt im Browser.

## Claude Desktop — ein Klick
1. **Zu Claude Desktop hinzufügen** lädt `one.mcpb` herunter (macOS, Windows). Datei öffnen — Claude Desktop fragt, ob es die Erweiterung installieren soll. Kein Terminal, kein Node.js.
2. Zurück in One: **KI-Agenten auf diesem Computer erlauben** einschalten.
3. Frag Claude Desktop: *„Was steht in meinem One-Workspace?“*

**Codewort:** Beginne eine Nachricht mit `one:` — *„one: räum meine Projects-Datenbank auf“* — und Claude nutzt dafür One, nicht das Web oder andere Connectoren. Claude Desktop führt es auch im Prompt-Menü (**+** → *One*), Claude Code als `/mcp__one__one`.

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

## Aufräumen
Agenten können auch umorganisieren: Seiten und Datenbanken im Baum verschieben, eine Zeile in eine andere Datenbank mit passenden Eigenschaften verschieben, Datenbanken umbenennen, Eigenschaften (Optionen, sichere Typwechsel) und Ansichten ändern, Eigenschaften und Ansichten löschen, Seiten, Zeilen und ganze Datenbanken in den Papierkorb legen — bis zu 50 auf einmal — und wiederherstellen. Endgültig gelöscht wird nichts. Eine gesperrte Datenbank lehnt Strukturänderungen ab; das Sperren bleibt deine Entscheidung. Jede Änderung zeigt, was geht (*Datenbank „Projects“ mit 8 Zeilen → Papierkorb*), und lässt sich im **Agenten-Protokoll** rückgängig machen. Brücken vor 1.2.0 kennen diese Tools nicht: `one.mcpb` neu herunterladen.

Der neueste Tab eines Workspace bekommt die Brücke. Standard-Port ist 47321 (`ONE_MCP_PORT` ändert ihn). Details: `docs/MCP.md` im Repository.
