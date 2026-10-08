---
id: mcp-token-rejected
title: MCP-Token abgelehnt
section: trouble
order: 3
keywords: mcp, token, abgelehnt, abgelaufen, nicht autorisiert, 401, serverfehler, token fehlt, rejected, expired
related: mcp-servers, anthropic-unreachable, claude-key
summary: „Der MCP-Server hat das Token abgelehnt“ — Token ersetzen oder den Server ausschalten.
---
**Der MCP-Server „kb“ hat das Token abgelehnt — es ist vielleicht falsch oder abgelaufen.** Claude kann diesen Server erst wieder nutzen, wenn er ein gültiges Token bekommt.

1. Im Dienst (z. B. deiner Wissensdatenbank) ein neues Token erstellen — möglichst nur lesend — oder prüfen, ob das alte noch gilt.
2. In One: **Einstellungen → Claude KI → MCP-Server**, beim Server **Erweitert** öffnen.
3. **Token** → **Ersetzen**, das neue Token einfügen und bestätigen. One testet die Verbindung sofort; die LED sollte auf **Verbunden** springen.

Ein Server mit eigener Anmeldung (OAuth): Drück stattdessen **Anmelden** in seiner Zeile. Im [KI-Terminal](help:agent) zeigt eine so gescheiterte Aufgabe **Bei kb anmelden** — oder drück <kbd>Enter</kbd> in der leeren Eingabe; das Fenster öffnet sich, und ist er verbunden, führt **Aufgabe erneut ausführen** (<kbd>Enter</kbd>) sie mit der neuen Anmeldung aus. `/verbinden kb` macht dasselbe jederzeit.

## Verwandte Meldungen
- **Dieser Browser hat keine Kopie des Tokens** — Tokens sind pro Browser versiegelt. Auf einem neuen Gerät oder nach dem Löschen der Browserdaten trägst du das Token unter **Erweitert** erneut ein.
- **Claude konnte den MCP-Server „…“ nicht nutzen** — prüf die **Server-URL** (https, der MCP-Endpunkt des Servers) und dass der Server aus dem Internet erreichbar ist: Anthropic verbindet sich mit ihm, nicht dein Browser.
- **Dieser Server bietet keine Anmeldung an** — er hat keine Anmeldeseite, die One nutzen kann: Füg stattdessen ein Token ein (**Stattdessen Token einfügen** im Terminal öffnet die Einstellungen).
- Du brauchst Claude jetzt? Schalte den Server mit seinem Schalter aus — Anfragen laufen dann ohne ihn.
