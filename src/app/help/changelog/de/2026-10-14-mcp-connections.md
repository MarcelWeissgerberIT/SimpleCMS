---
id: 2026-10-14-mcp-connections
date: 2026-10-14
order: 2
title: MCP · Verbindungen – was verbunden ist, auf einer Seite
summary: Eine Seite zeigt jede MCP-Verbindung, die One kennt – die MCP-Server von Claude in One, Claude Desktop und Claude Code über diesen Tab, Claude Code im Coding-Worker, den Team-Server –, jede mit Lampe und der Taste, die hilft.
image: assets/shots/changelog/mcp-connections.webp
alt: Die Seite MCP · Verbindungen – die Anzeige (Claude in One 3 an · 1 aus, braucht dich 2, Brücke verbunden, Worker verbunden · 1 Repo), § 01 Claude in One mit nordlicht OK und angemeldet, tessera Token abgelehnt mit Anmelden, archiv Test fehlgeschlagen und polar aus, die Zeile mit einem Server, den Agenten nennen, der aber nicht eingerichtet ist, § 02 die Brücke verbunden mit Claude Desktop, § 03 der Coding-Worker studio-mac mit den MCP-Servern von Claude Code in seinem Repository (nordlicht auch in One).
help: mcp-servers, mcp-bridge, mcp-token-rejected
try: mcp
---
**Alles, was verbunden ist, an einem Ort.** ⌘K **MCP** öffnet **MCP · Verbindungen** (`#/mcp`); **Alle Verbindungen →** unter **Einstellungen → Agenten · MCP** und **Einstellungen → KI → MCP-Server** öffnet sie auch.

- **Claude in One** – deine MCP-Server, jeder mit Lampe: **OK** mit seinen Werkzeugen, **Test fehlgeschlagen**, **Token abgelehnt**, **Anmeldung abgelaufen**, **Aus**. Die Lampen folgen der Token-Lampe im Vorflug-Check – dort sind dieselben Server rot.
- **Claude Desktop · Code** – ob die Brücke dieses Tabs verbunden ist, mit welchem Client, und was Agenten ändern dürfen.
- **Coding-Worker** – die Verbindung zum Worker und die MCP-Server, die Claude Code dort hat, pro Repository.
- **Team-Server** – in einem Team-Workspace: die `/mcp`-Adresse des Workspace zum Kopieren und die MCP-Server der Server-Agenten.

**Direkt in der Zeile beheben.** **Testen** prüft eine Verbindung (eine kurze Claude-Anfrage), **Anmelden** erneuert eine abgelehnte, **Einstellungen ↗** öffnet genau diesen Server.

Die Seite sendet beim Öffnen nichts und öffnet kein Token – sie zeigt, was One zuletzt sah, und jeder Abschnitt sagt, ob er zu diesem Gerät, diesem Tab, diesem Browser oder dem Team-Server gehört. Mehr unter [MCP-Server](help:mcp-servers).
