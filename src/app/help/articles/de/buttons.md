---
id: buttons
title: Schaltflächen
section: writing
order: 9
keywords: schaltfläche, knopf, button, aktion, klick, automatisieren, blöcke einfügen, eintrag anlegen, webhook
related: automations, templates, databases
summary: Eine Schaltfläche führt mit einem Klick eine Liste von Aktionen aus.
---
Einfügen mit `/schaltfläche` (oder `/button`), eine **Beschriftung** und einen Stil wählen (**Signal**, **Tinte**, **Kontur**), dann **Aktionen — der Reihe nach** hinzufügen:

- **Blöcke einfügen** — z. B. eine Besprechungsagenda, geschrieben im kleinen Editor der Schaltfläche,
- **Seite in Datenbank anlegen** — mit Eigenschaftswerten, auf Wunsch geöffnet,
- **Eigenschaften dieser Seite ändern** — auf einem Datenbankeintrag,
- **Webhook senden** — an n8n, Make, Zapier oder jede URL,
- **Link oder Seite öffnen**,
- **Nachricht anzeigen**.

Texte können `{{date}}`, `{{time}}` und `{{user}}` enthalten, die beim Klick ausgefüllt werden; Datumsfelder lassen sich auf heute oder jetzt setzen, ein Personenfeld auf **Ich**. **Bearbeiten** an der Schaltfläche ändert sie.

> Freigabe-Links, Exporte und veröffentlichte Websites behalten die Beschriftung, aber nie die Aktionen (keine Webhook-URL verlässt deinen Workspace).
