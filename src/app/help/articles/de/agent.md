---
id: agent
title: Das KI-Terminal
section: ai
order: 3
keywords: agent, ki-terminal, terminal, claude, automatisieren, massenänderung, aufgaben, einträge, seiten, datenbanken, board, übernehmen, prüfen, tastatur, befehle, referenzen, workspace agent, AI terminal
related: custom-agents, ai-menu, mcp-servers, mcp-bridge
summary: Gib Claude Aufgaben per Tastatur — es liest deinen Workspace, schlägt Änderungen vor, und du übernimmst sie. Arbeitet auch ausgeblendet weiter.
---
Drück <kbd>Mod+J</kbd> (oder ⌘K → *KI-Terminal*, oder **KI** in der Statusleiste). Das Terminal dockt unter der Seite an — die Seitenleiste bleibt —, auf dem Handy füllt es den Bildschirm.

1. Tipp eine Aufgabe, z. B. *„Mach aus den Meeting-Notizen dieser Woche Aufgaben in Projekte“* oder *„Mach ein Board aus den offenen Punkten dieser Seite“*, und drück <kbd>Enter</kbd> (<kbd>Shift+Enter</kbd> für eine neue Zeile).
2. Claude durchsucht und liest deine Seiten und Datenbanken; die Antwort läuft live ein, jeder Tool-Aufruf ist eine Zeile im Protokoll (`→ search_pages "Delta"`, `✓ create_row … vorgemerkt #2`).
3. Änderungen werden **vorgeschlagen**, nicht geschrieben: neue Seiten, Einträge, Datenbanken und Eigenschaften, geänderte Werte und Titel landen in einer Prüfliste. Einzeln übernehmen, **Alle übernehmen** (<kbd>Mod+Enter</kbd> oder `/übernehmen`) oder verwerfen. Ein **Rückgängig** nimmt einen übernommenen Stapel zurück.

## Es arbeitet weiter
Blende das Terminal mit <kbd>Esc</kbd> oder <kbd>Mod+J</kbd> aus und arbeite weiter — die Aufgabe läuft weiter. Die Statusleiste zeigt **KI · arbeitet** und danach **KI · 3 Änderungen zu prüfen**; eine Meldung sagt Bescheid, wenn sie fertig ist, ein Klick holt das Terminal zurück. Nur **Stopp** beendet eine Aufgabe: <kbd>Mod+.</kbd>, <kbd>Ctrl+C</kbd> (ohne Markierung), `/stopp` oder die Stopp-Taste. Die bisherigen Vorschläge bleiben.

## Kontext
- Die **offene Seite** geht als Chip mit — entfern sie mit ×, wenn es nicht um sie geht.
- **Referenzen:** Markiere Text auf einer Seite und drück **Zum Terminal** in der Werkzeugleiste oder <kbd>Mod+Shift+J</kbd> (auch auf schreibgeschützten Seiten und in Datenbank-Einträgen). Die Stelle wird zum Chip; bis zu 10 gehen mit der nächsten Aufgabe als Markdown samt Seite mit und wandern dann in deren Protokollzeile. <kbd>Rücktaste</kbd> am Anfang der Eingabe entfernt den letzten Chip.
- **Erwähnungen:** Tipp `@` und einen Teil eines Titels, dann <kbd>Tab</kbd>: Die Seite oder Datenbank geht als Kontext mit.

## Tasten und Befehle
- <kbd>↑</kbd> / <kbd>↓</kbd> in der ersten / letzten Zeile: frühere Eingaben (die letzten 50 auf diesem Gerät und in diesem Workspace, nie synchronisiert).
- <kbd>Tab</kbd> ergänzt `/Befehle` und `@`-Erwähnungen; bei leerer Eingabe springt es in die Prüfliste.
- In der Prüfliste: <kbd>j</kbd> / <kbd>k</kbd> (oder Pfeile) bewegen, <kbd>Leertaste</kbd> markiert, <kbd>Enter</kbd> übernimmt die markierten (oder den aktuellen) Einträge, <kbd>a</kbd> übernimmt alle, <kbd>d</kbd> verwirft, <kbd>o</kbd> öffnet die Seite, <kbd>u</kbd> macht das letzte Übernehmen rückgängig, <kbd>Esc</kbd> führt zurück zur Eingabe.
- <kbd>Alt+↑</kbd> / <kbd>Alt+↓</kbd> oder Ziehen an der Oberkante ändern die Höhe; Maximieren füllt den Inhaltsbereich.
- `/neu` beginnt neu · `/stopp` · `/übernehmen` · `/verwerfen` · `/verlauf` · `/mcp` (verwendete Server) · `/kosten` (Tokens und geschätzte Kosten) · `/hilfe`. Die englischen Namen gehen auch: `/new`, `/stop`, `/apply`, `/discard`, `/history`, `/cost`, `/help`.

## Gut zu wissen
- Claude kann Datenbanken anlegen (eine Tabelle oder ein Board, gruppiert nach einer Spalte) und Eigenschaften ergänzen und sie in derselben Aufgabe mit Einträgen füllen. Gesperrte Datenbanken lehnen neue Eigenschaften ab.
- Eine Aufgabe endet an einem Limit von Tool-Aufrufen; Claude soll dann zusammenfassen. Hinzugefügte MCP-Server stehen zur Verfügung.
- Die Anzeige zeigt Tokens und geschätzte Kosten (Anthropic rechnet über deinen Schlüssel ab). Nichts ändert sich, bevor du übernimmst; im Team-Workspace sehen Leser die Vorschläge, können sie aber nicht übernehmen.
