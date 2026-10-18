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
1. **Name des Tokens** (z. B. *Zapier – CRM-Sync*), **Zugriff**: **Nur lesen** oder **Lesen & schreiben**, und **Kommentare (MCP)**: ob ein MCP-Client mit diesem Token Kommentare lesen darf (standardmäßig aus).
2. **Token erstellen** — **nur einmal sichtbar**: jetzt kopieren. Der Server speichert nur einen Fingerabdruck; verlorene Tokens widerrufst und ersetzt du.
3. **Mit curl testen** zeigt ein fertiges Beispiel.

Die REST-API (`/api/v1`) listet Datenbanken, liest, legt an und ändert Einträge und Seiten. Referenz: [docs/API.md](https://github.com/MarcelWeissgerberIT/SimpleCMS/blob/main/docs/API.md) (englisch).

## Eingehende Webhooks
**Webhook erstellen** für eine Datenbank: Was an ihre URL gePOSTet wird — JSON oder Formularfelder — wird ein Eintrag; Felder passen über die Eigenschaftsnamen. Das Geheimnis steckt in der URL, nur einmal sichtbar; **Neue URL** ersetzt sie.

## MCP für Agenten
Der Server bietet außerdem einen MCP-Endpunkt unter `https://<dein Server>/mcp` für Claude Code, Cursor und andere Clients, mit denselben API-Tokens — Seiten vollständig, Bäume aus Unterseiten, Boards mit ihren Zeilen und Zeilen im Stapel. Beidseitige Relationen — auch Unterelemente und Abhängigkeiten — setzt du in One (oder über die REST-API), nicht über MCP; einseitige gehen. Details: `docs/MCP.md`.

## Letzte MCP-Schreibvorgänge
Der MCP-Endpunkt ändert ohne Rückfrage, deshalb behält der Server 14 Tage lang eine Kopie dessen, was ein MCP-Aufruf angelegt oder überschrieben hat: angelegte Seiten, Zeilen und Datenbanken, geänderte Zeilenwerte, den Text einer Seite vor dem Ersetzen. Aufrufe an Eigenschaften, Ansichten, Verschieben und Papierkorb, ein neuer Titel oder ein neues Symbol und reines Anhängen an eine Seite behalten keine Kopie und stehen nicht in der Liste – die machst du in One rückgängig (Seitenverlauf, Papierkorb). **Letzte MCP-Schreibvorgänge** (Inhaber und Admins) listet die Aufrufe — welches Token, was angelegt und geändert wurde — und **Zurückholen** macht einen rückgängig: Angelegtes kommt in den Papierkorb und Werte gehen zurück – außer jemand hat sie seitdem geändert: Eine Seite, in die jemand geschrieben hat, eine seitdem geänderte Zeile oder ein geänderter Wert bleibt und wird genannt (dann **Trotzdem zurückholen**); eine Seite oder Datenbank, die bleibt, behält ihren Link oder Block in der Seite, in die der Aufruf sie gesetzt hat. Ein seitdem geänderter Seitentext wird nur zurückgeholt, wenn du bestätigst, dass die späteren Änderungen verloren gehen. Ein älterer Team-Server sagt dort in einer Zeile, dass er für diese Liste ein Update braucht.

> Private Seiten sind über API, Webhooks und MCP nie erreichbar.
