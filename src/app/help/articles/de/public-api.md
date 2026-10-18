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
Der MCP-Endpunkt ändert ohne Rückfrage, deshalb behält der Server 14 Tage lang eine Kopie dessen, was ein MCP-Aufruf angelegt oder überschrieben hat: angelegte Seiten, Zeilen und Datenbanken, geänderte Zeilenwerte, den Text einer Seite vor dem Ersetzen. Aufrufe an Eigenschaften, Ansichten, Verschieben und Papierkorb, ein neuer Titel oder ein neues Symbol und reines Anhängen an eine Seite behalten keine Kopie und stehen nicht in der Liste – die machst du in One rückgängig (Seitenverlauf, Papierkorb). **Letzte MCP-Schreibvorgänge** (Inhaber und Admins) listet die Aufrufe — welches Token, was angelegt und geändert wurde — und **Zurückholen** macht einen Aufruf als Ganzes rückgängig: Angelegtes kommt in den Papierkorb, Werte und Texte bekommen ihren früheren Stand. Wurde seitdem etwas davon geändert – ein Wert, ein Text, eine Seite, die jemand umbenannt, verschoben, beschrieben oder unter die jemand eine Seite gelegt hat –, wird nichts zurückgeholt, und die Zeile nennt, was sich geändert hat. Dann machst du es in One rückgängig (Versionsverlauf, Papierkorb) oder wählst **Trotzdem zurückholen**: Das holt nur die Texte und Werte zurück, die der Aufruf geändert hat (spätere Änderungen dort gehen verloren), und legt nichts in den Papierkorb – was der Aufruf angelegt hat, bleibt und wird genannt, damit du es selbst in den Papierkorb legen kannst. In eine Zeile oder Seite, die der Aufruf geändert hat und die seitdem im Papierkorb liegt oder verschoben wurde, schreibt es nie. Ein Aufruf, der nur Seiten oder Zeilen angelegt hat, hat nichts, was „Trotzdem zurückholen“ zurückholen könnte. Ein älterer Team-Server sagt dort in einer Zeile, dass er für diese Liste ein Update braucht.

> Private Seiten sind über API, Webhooks und MCP nie erreichbar.
