---
id: 2026-10-04-mcp-servers
date: 2026-10-04
order: 4
title: MCP-Server für Ones Claude
summary: Verbinde eine Wissensdatenbank, einen Tracker oder ein CRM — Claude nutzt ihre Werkzeuge in deinen eigenen Anfragen und im Agenten.
image: assets/shots/changelog/mcp-servers.webp
alt: Einstellungen → Claude KI → MCP-Server: eine Wissensdatenbank, verbunden, mit drei Werkzeugen
help: mcp-servers, mcp-token-rejected, claude-key
try: settings-ai
---
**Einstellungen → Claude KI → MCP-Server.** Adresse des Servers und ein Token einfügen, **Speichern** — fertig. One benennt den Server, schaltet ihn ein und prüft ihn im Hintergrund: Es listet die Werkzeuge, die Claude sieht, und schreibt einen **Nutzungs-Prompt**, der Claude sagt, welches Werkzeug wofür da ist. Die LED springt auf **Verbunden**.

- Ab dann können das KI-Terminal, deine eigenen Anfragen im KI-Menü und `⌘K ?` den Server nutzen. Während Claude arbeitet, erscheint jeder Aufruf als kleiner Chip, z. B. `KB · search`.
- **Verwendet bei** entscheidet, ob auch Ein-Klick-Aktionen und Autofill ihn bekommen.
- Das Token liegt versiegelt in diesem Browser und geht nur mit den Anfragen, die den Server nutzen, an Anthropic.

> Tipp: Leg für One ein eigenes Token an, möglichst nur lesend.
