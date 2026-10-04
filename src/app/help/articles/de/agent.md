---
id: agent
title: Der Agent
section: ai
order: 3
keywords: agent, claude, automatisieren, massenänderung, aufgaben, einträge, seiten, übernehmen, prüfen, workspace agent
related: custom-agents, ai-menu, mcp-servers, mcp-bridge
summary: Beschreib eine Aufgabe für deinen Workspace — Claude liest, schlägt Änderungen vor, und du übernimmst sie.
---
Drück <kbd>Mod+J</kbd> (oder ⌘K → *Agent beauftragen…*). Der Agent öffnet sich rechts.

1. Beschreib eine Aufgabe, z. B. *„Mach aus den Meeting-Notizen dieser Woche Aufgaben in Projekte“* oder *„Gib jedem Eintrag der Leseliste einen Typ“*.
2. <kbd>Enter</kbd>. Claude durchsucht und liest deine Seiten und Datenbanken; jeder Schritt erscheint im Protokoll.
3. Änderungen werden **vorgeschlagen**, nicht geschrieben: neue Seiten, neue Einträge, geänderte Eigenschaften und Titel landen in einer Prüfliste.
4. Prüfen, dann einzeln **Übernehmen** oder **Alle übernehmen** (<kbd>Mod+Enter</kbd>). **Verwerfen**, was du nicht willst; **Wiederherstellen** holt einen verworfenen Vorschlag zurück.

Nachfragen oder Korrekturen schreibst du ins selbe Feld. **Neue Aufgabe** beginnt neu; **Stopp** beendet einen Lauf — die bisherigen Vorschläge bleiben.

## Gut zu wissen
- Die Anzeige unten zeigt Tokens und geschätzte Kosten der Aufgabe (dein Schlüssel).
- Eine Aufgabe endet an einem Limit von Tool-Aufrufen; Claude soll dann zusammenfassen.
- Hinzugefügte MCP-Server (z. B. Atlas) stehen dem Agenten zur Verfügung.
- Nichts ändert sich, bevor du übernimmst. Im Team-Workspace sehen Leser die Vorschläge, können sie aber nicht übernehmen.
