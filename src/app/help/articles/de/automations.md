---
id: automations
title: Automationen & Webhooks
section: databases
order: 9
keywords: automation, automationen, webhook, n8n, make, zapier, auslöser, aktion, benachrichtigen, eigenschaft setzen, integration, trigger
related: buttons, forms, public-api, ai-autofill
summary: Wenn ein Eintrag angelegt, geändert oder gelöscht wird — Webhook senden, Eigenschaft setzen oder Hinweis zeigen.
---
Öffne **Automationen** (der Blitz in der Werkzeugleiste der Datenbank, oder Seitenoptionen **•••** → **Automationen**). Starte mit einem Rezept oder leg eine neue an:

- **Neue Zeilen an n8n / Make / Zapier**
- **Benachrichtigen bei Status → Erledigt**
- **Datum stempeln bei Erledigt**

## Wenn … dann …
- **Auslöser:** **Zeile erstellt**, **Eigenschaft geändert** (beliebige Eigenschaft, oder eine, die zu einem Wert wechselt), **Zeile gelöscht**.
- **Aktionen**, der Reihe nach: **Webhook senden** (POST oder PUT an eine https-URL), **Eigenschaft setzen** (z. B. heute, abgehakt, ein Status), **Benachrichtigung zeigen**.

Mit **Aktiv** schaltest du sie scharf; die LED zeigt scharf, Einrichtung nötig oder letzter Lauf fehlgeschlagen. **Test senden** schickt ein Beispiel, **Payload** zeigt das JSON, das jeder Webhook bekommt, und **Als n8n-Workflow kopieren** liefert einen fertigen Webhook-Trigger zum Einfügen in n8n. Das **Protokoll** listet die letzten 30 Läufe dieser Sitzung.

> Automationen laufen in deinem Browser, solange One geöffnet ist. Eine neue Zeile löst aus, sobald sie einen Titel hat und das Tippen pausiert. Webhooks brechen nach 10 s ab, und der empfangende Dienst muss Anfragen aus dem Browser erlauben (CORS).

Im Team-Workspace kann auch der Server Daten empfangen: siehe **Öffentliche API & Webhooks**.
