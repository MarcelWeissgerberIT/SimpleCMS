---
id: mcp-servers
title: MCP-Server (Wissensdatenbanken & Co.)
section: ai
order: 6
keywords: mcp, mcp-server, werkzeuge, connector, wissensdatenbank, token, externe werkzeuge, integration, codewort, kb:, tools, knowledge base, codeword
related: agent, ai-menu, mcp-token-rejected, mcp-bridge, claude-key
summary: Lass Ones Claude die Werkzeuge anderer Systeme nutzen — eine Wissensdatenbank, einen Tracker, ein CRM.
---
**Einstellungen → Claude KI → MCP-Server.** Dafür brauchst du zuerst [deinen Claude-Schlüssel](help:claude-key).

## Server hinzufügen (Beispiel Wissensdatenbank)
1. In deiner Wissensdatenbank die MCP-Server-Adresse kopieren (`https://…/mcp`) und ein Token für One erstellen — nur lesend und auf die nötigen Projekte beschränkt, wenn sie das anbietet.
2. In One: **Server hinzufügen**, **Server-URL** und **Token** einfügen, **Speichern**.
3. One benennt den Server nach seiner Adresse, schaltet ihn ein und prüft ihn im Hintergrund: Verbindungstest, Liste der Werkzeuge, die Claude sieht, und ein **Nutzungs-Prompt**, der Claude sagt, welches Werkzeug wofür da ist. Die LED springt auf **Verbunden**.

## Wo er genutzt wird
**Erweitert** → **Verwendet bei**:
- **Agent, eigene Anfragen und ⌘K-Fragen** (Standard) — der Agent, deine eigenen Anfragen im KI-Menü und `?` in ⌘K.
- **Alle KI-Aufrufe** — auch die Ein-Klick-Aktionen, KI-Autofill und Besprechungszusammenfassungen. Jede dieser Anfragen wird länger und langsamer.

Unter **Erweitert** stehen außerdem Name, Codewort (unten), Token, Nutzungs-Prompt (**Erzeugen** / **Neu erzeugen**, oder selbst schreiben), **Verbindung testen** und **Server entfernen**. Während Claude arbeitet, erscheinen MCP-Aufrufe als kleine Chips, z. B. `KB · search`.

## Codewort
**Erweitert** → **Codewort**: ein kurzes Wort wie `kb` — One schlägt den Namen des Servers vor, **verwenden** übernimmt ihn. Beginne eine Anfrage damit — *„kb: Was wissen wir über den Launch?“* — im KI-Menü, bei `⌘K ?` oder im Agenten, und Claude antwortet zuerst mit den Werkzeugen dieses Servers (das `kb:` selbst wird nicht mitgeschickt). Mehrere gehen auch: `kb: wiki: …`.
- Beim Tippen zeigt ein Chip den Server: `→ ATLAS`. Ein ausgeschalteter Server bleibt aus — die Antwort sagt das.
- a–z, 0–9, `-` und `_`, bis 24 Zeichen, eines je Server. `one` ist reserviert: Das ist Ones eigenes Codewort in Claude Desktop ([Claude Desktop & lokales MCP](help:mcp-bridge)).

## Wie es funktioniert — und das Token
Anfragen gehen an `api.anthropic.com`; Anthropic verbindet sich mit dem Server, während Claude antwortet. Deshalb gehen nur entfernte Server, die per HTTPS erreichbar sind (Streamable HTTP oder SSE) — keine lokalen und keine, die nur eine interaktive Anmeldung (OAuth) anbieten.

> Das Token geht mit jeder Anfrage, die den Server nutzt, an Anthropic und liegt versiegelt in diesem Browser — nie in Backups, Exporten oder Sync. Nimm ein eigenes Token für One, möglichst nur lesend. Auf einem anderen Gerät trägst du das Token erneut ein.
