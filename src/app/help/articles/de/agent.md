---
id: agent
title: Das KI-Terminal
section: ai
order: 3
keywords: agent, ki-terminal, terminal, claude, automatisieren, massenänderung, aufgaben, einträge, seiten, datenbanken, board, übernehmen, prüfen, tastatur, befehle, referenzen, kontext, was claude liest, neu machen, ändern, ersetzen, umschreiben, diff, workspace agent, AI terminal, context, edit
related: custom-agents, ai-menu, mcp-servers, mcp-bridge
summary: Gib Claude Aufgaben per Tastatur — es liest deinen Workspace, schlägt Änderungen vor, und du übernimmst sie. Arbeitet auch ausgeblendet weiter.
---
Drück <kbd>Mod+J</kbd> (oder ⌘K → *KI-Terminal*, oder **KI** in der Statusleiste). Das Terminal dockt unter der Seite an — die Seitenleiste bleibt —, auf dem Handy füllt es den Bildschirm.

1. Tipp eine Aufgabe, z. B. *„Mach aus den Meeting-Notizen dieser Woche Aufgaben in Projekte“* oder *„Mach ein Board aus den offenen Punkten dieser Seite“*, und drück <kbd>Enter</kbd> (<kbd>Shift+Enter</kbd> für eine neue Zeile).
2. Claude durchsucht und liest deine Seiten und Datenbanken; die Antwort läuft live ein, jeder Tool-Aufruf ist eine Zeile im Protokoll (`→ search_pages "Delta"`, `✓ create_row … vorgemerkt #2`).
3. Änderungen werden **vorgeschlagen**, nicht geschrieben: neue Seiten, Einträge, Datenbanken und Eigenschaften, geänderte Werte und Titel landen in einer Prüfliste. Einzeln übernehmen, **Alle übernehmen** (<kbd>Mod+Enter</kbd> oder `/übernehmen`) oder verwerfen. Ein **Rückgängig** nimmt einen übernommenen Stapel zurück.

## Bestehenden Text ändern
Claude ergänzt eine Seite per *Anhängen*. Verlangt eine Aufgabe, Vorhandenes zu **korrigieren, umzuschreiben, zu aktualisieren oder zu entfernen**, ändert es stattdessen genau diese Blöcke: Es liest die Seite mit einer kurzen Marke je Block (`b3`) und nennt die Blöcke, die es ändert — ersetzen, löschen, danach einfügen oder die ganze Seite neu schreiben, wenn du das willst. Jede Änderung ist ein eigener Vorschlag, gezeigt als **Diff** der Seite: entfernte Wörter rot durchgestrichen, neue orange hinterlegt, unveränderte Blöcke eingeklappt (*12 unveränderte Blöcke — anzeigen*).

- Jede Änderung einzeln übernehmen oder verwerfen. Was du von einer Seite zusammen übernimmst, geht in einem Schritt hinein: Vorher wird eine Version gesichert (**KI** im [Versionsverlauf](help:history)), und <kbd>Mod+Z</kbd> auf der offenen Seite nimmt die ganze Änderung zurück.
- Einen Block, den du geändert hast, nachdem Claude den Vorschlag gemacht hat, **überspringt** One — er wird nie überschrieben, die Prüfung sagt es dir.
- Blöcke, die du vom Lesen ausgenommen hast (siehe unten), kann Claude auch nicht ändern; die ganze Seite neu schreiben wird dann abgelehnt.
- [Eigene Agenten](help:custom-agents) können auch Änderungen vorschlagen; selbst ein Agent, der direkt schreibt, wartet auf dein OK, bevor er Text ersetzt.

## Es arbeitet weiter
Blende das Terminal mit <kbd>Esc</kbd> oder <kbd>Mod+J</kbd> aus und arbeite weiter — die Aufgabe läuft weiter. Die Statusleiste zeigt **KI · arbeitet** und danach **KI · 3 Änderungen zu prüfen**; eine Meldung sagt Bescheid, wenn sie fertig ist, ein Klick holt das Terminal zurück. Nur **Stopp** beendet eine Aufgabe: <kbd>Mod+.</kbd>, <kbd>Ctrl+C</kbd> (ohne Markierung), `/stopp` oder die Stopp-Taste. Die bisherigen Vorschläge bleiben.

## Kontext
- Die **offene Seite** geht als Chip mit — entfern sie mit ×, wenn es nicht um sie geht.
- **Referenzen:** Markiere Text auf einer Seite und drück **Zum Terminal** in der Werkzeugleiste oder <kbd>Mod+Shift+J</kbd> (auch auf schreibgeschützten Seiten und in Datenbank-Einträgen). Die Stelle wird zum Chip; bis zu 10 gehen mit der nächsten Aufgabe als Markdown samt Seite mit und wandern dann in deren Protokollzeile. <kbd>Rücktaste</kbd> am Anfang der Eingabe entfernt den letzten Chip.
- **Erwähnungen:** Tipp `@` und einen Teil eines Titels, dann <kbd>Tab</kbd>: Die Seite oder Datenbank geht als Kontext mit.

## Was Claude liest
Der Chip der offenen Seite sagt, wie viel Claude davon lesen darf: nur der Titel bei der ganzen Seite, *· 3 Blöcke* bei markierten Blöcken, *· nichts*, wenn du sie ausgenommen hast. Ein Klick auf den Chip bietet **Ganze Seite**, **Nur markierte Blöcke**, **Blöcke markieren…** (oder `/kontext`) und **Nichts von dieser Seite** — dieselben Markierungen wie im [KI-Menü](help:ai-menu). Dann liefern `read_page` (und die Suche) von dieser Seite nur die markierten Blöcke oder halten sie zurück, und Claude erfährt das; Schreiben auf die Seite geht wie gewohnt, mit deiner Prüfung. Andere Seiten sind nicht betroffen; Referenzen schicken weiter genau den markierten Text. `/neu-machen` markiert Stellen der offenen Seite, die Claude mit Vorgaben neu macht.

## Tasten und Befehle
- <kbd>↑</kbd> / <kbd>↓</kbd> in der ersten / letzten Zeile: frühere Eingaben (die letzten 50 auf diesem Gerät und in diesem Workspace, nie synchronisiert).
- <kbd>Tab</kbd> ergänzt `/Befehle` und `@`-Erwähnungen; bei leerer Eingabe springt es in die Prüfliste.
- In der Prüfliste: <kbd>j</kbd> / <kbd>k</kbd> (oder Pfeile) bewegen, <kbd>Leertaste</kbd> markiert, <kbd>Enter</kbd> übernimmt die markierten (oder den aktuellen) Einträge, <kbd>a</kbd> übernimmt alle, <kbd>d</kbd> verwirft, <kbd>o</kbd> öffnet die Seite, <kbd>u</kbd> macht das letzte Übernehmen rückgängig, <kbd>Esc</kbd> führt zurück zur Eingabe.
- <kbd>Alt+↑</kbd> / <kbd>Alt+↓</kbd> oder Ziehen an der Oberkante ändern die Höhe; Maximieren füllt den Inhaltsbereich.
- `/neu` beginnt neu · `/stopp` · `/übernehmen` · `/verwerfen` · `/verlauf` · `/mcp` (verwendete Server) · `/kosten` (Tokens und geschätzte Kosten) · `/kontext` (was Claude auf der offenen Seite liest) · `/neu-machen` (Stellen mit Vorgaben neu machen) · `/merken <Satz>`, `/ohne-gedächtnis`, `/beispiel <Tag>` ([One-Gedächtnis](help:memory)) · `/hilfe`. Die englischen Namen gehen auch: `/new`, `/stop`, `/apply`, `/discard`, `/history`, `/cost`, `/context`, `/redo`, `/remember`, `/no-memory`, `/example`, `/help`.

## Gut zu wissen
- Claude kann Datenbanken anlegen (eine Tabelle oder ein Board, gruppiert nach einer Spalte) und Eigenschaften ergänzen und sie in derselben Aufgabe mit Einträgen füllen. Gesperrte Datenbanken lehnen neue Eigenschaften ab.
- Eine Aufgabe endet an einem Limit von Tool-Aufrufen; Claude soll dann zusammenfassen. Hinzugefügte MCP-Server stehen zur Verfügung.
- Die Anzeige zeigt Tokens und geschätzte Kosten (Anthropic rechnet über deinen Schlüssel ab). Nichts ändert sich, bevor du übernimmst; im Team-Workspace sehen Leser die Vorschläge, können sie aber nicht übernehmen.
- Das [One-Gedächtnis](help:memory) geht mit jeder Aufgabe mit (**GEDÄCHTNIS · 3** im Kopf), und nach einer Aufgabe schlägt Claude vielleicht vor, was es sich merken soll — gespeichert nur mit deinem OK. `#tag` nimmt ein gespeichertes Beispiel ganz mit.
