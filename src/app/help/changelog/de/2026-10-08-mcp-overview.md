---
id: 2026-10-08-mcp-overview
date: 2026-10-08
order: 1
title: Eine Tabelle für deine MCP-Server – Codewort und wo jeder genutzt werden darf
summary: Einstellungen → Claude KI → MCP-Server beginnt mit einer Übersicht – pro Server sein Codewort, welche Anfragen von Claude in One ihn nutzen, die Agenten und Integrationen dazu und ob Claude Code im Worker ihn hat.
image: assets/shots/changelog/mcp-overview.webp
alt: Die Übersichtstabelle mit den Zeilen TRACKER (Codewort kb:, jede KI-Anfrage, die Agenten Daily digest mit 2 Werkzeugen und Triage, die Integration Item tracker, Claude Code im Repo website), WIKI ausgeschaltet und notes, ein Server, den nur Claude Code hat
help: mcp-servers
try: settings-ai
---
**Einstellungen → Claude KI → MCP-Server** beginnt jetzt mit einer Tabelle: eine Zeile pro Server.

- **Codewort** – das `kb:`, mit dem eine Anfrage den Server zuerst anspricht.
- **Claude in One** – *Agent, eigene Anfragen, ⌘K*, *Jede KI-Anfrage* oder *Aus* (dann erreicht ihn auch sein Codewort nicht).
- **Eigene Agenten** – die Agenten, die ihn nutzen; eine Werkzeugliste zeigt, wie viele Werkzeuge sie dürfen, ein ausgeschalteter Agent ist durchgestrichen.
- **Integrationen** – die Integrationsprofile, die dieser Server aktiv macht (sichtbar, sobald es eines gibt).
- **Claude Code (Worker)** – die Repositories (und *Aufgaben ohne Repository*), in denen Claude Code im Coding-Worker einen Server gleichen Namens oder Codeworts hat. Ein Server, den nur Claude Code hat, bekommt eine eigene Zeile.

Ein Klick auf den Namen öffnet die Einstellungen des Servers darunter. Auf dem Handy ist jeder Server eine Karte.

> Die Spalte Claude Code braucht den neuesten Worker – lade ihn auf #/coding neu herunter.
