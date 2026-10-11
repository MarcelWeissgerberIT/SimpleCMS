---
id: tasks
title: Aufgaben
section: writing
order: 6
keywords: aufgabe, aufgaben, task, to-do, todo, fällig, termin, frist, zuweisen, verantwortlich, blockiert, blocker, abhängig, wartet, verknüpft, [!], Mod+Enter, due, assign, blocked, depends
related: mentions-dates, blocks, templates, keyboard-shortcuts, team-cloud
summary: Eine Aufgabe ist ein Block mit Status, Termin, Verantwortlichen und dem, worauf sie wartet — direkt im Text.
---
**Eine Aufgabe, keine Checkbox.** Tippe `/aufgabe` (oder `/task`) — oder `[!]` und ein Leerzeichen am Zeilenanfang. Die erste Zeile ist der Titel; Notizen kommen darunter, <kbd>Shift+Enter</kbd> springt dorthin. Eine To-do-Liste in den Notizen zählt als Schritte (**2/4**).

## Status
- Klick auf die Taste links: Die Aufgabe ist **erledigt** — ein zweiter Klick öffnet sie wieder. <kbd>Mod+Enter</kbd> macht dasselbe, solange der Cursor in der Aufgabe steht (ein To-do in ihren Notizen wird zuerst abgehakt).
- **In Arbeit**: <kbd>Alt</kbd>-Klick auf die Taste, der kleine Pfeil neben der Taste oder <kbd>Mod+Alt+Enter</kbd>.
- <kbd>Enter</kbd> am Ende eines Titels legt die nächste Aufgabe an, am Anfang eine neue davor. <kbd>Enter</kbd> in einem leeren Titel ohne Felder macht wieder eine Zeile daraus; <kbd>Backspace</kbd> am Anfang eines leeren Titels löst die Aufgabe auf.

## Termin, Personen, Verknüpfungen
Über die Chips unter dem Titel — oder <kbd>Alt+Enter</kbd> für das Menü der Aufgabe: **Fällig …**, **Zuweisen …**, **Blockiert durch …**, **Verknüpft …**, **Hält auf …**. Leere Felder erscheinen als gestrichelte Tasten (**+ DATUM**, **+ PERSON**, **+ ABHÄNGIG**, **+ NOTIZ**), solange der Cursor in der Aufgabe steht. `@` im Titel bietet über den üblichen Erwähnungen **Zuweisen: …** und **Fällig: …** an.

In einer Auswahl lässt <kbd>Esc</kbd> alles, wie es war; **Fertig** (oder <kbd>Enter</kbd>) schreibt es.

## Blockiert
Eine Aufgabe **wartet**, solange etwas, wodurch sie blockiert ist, noch offen ist — live berechnet, nie gespeichert. Sie zeigt **BLOCKIERT**, für jeden Blocker einen Chip mit eigener Lampe und **WARTET AUF 2 VON 3**. Erledigen kannst du sie trotzdem: One fragt einmal nach. Wer einen Blocker erledigt, erfährt, wer jetzt loslegen kann (**Freigegeben: …** mit **Öffnen**); öffnest du ihn wieder, sind die anderen wieder blockiert.

Eine Verknüpfung, die eine Schleife schließen würde, wird abgelehnt. Kommt doch eine an (zwei Personen verknüpfen im selben Moment), zeigt sie **SCHLEIFE** und blockiert nie. **HÄLT n AUF** und **n VERKNÜPFT** listen die andere Seite, mit **Verknüpfung entfernen** und Rückgängig.

## Erinnerungen
Ein Termin kann dich erinnern wie eine [Datums-Erwähnung](help:mentions-dates): **Erinnern** in der Terminauswahl. Eine erledigte Aufgabe erinnert niemanden. In einem Team-Arbeitsbereich erinnert eine Aufgabe mit Personen nur diese; ist niemand zugewiesen, erinnert sie jedes Mitglied — die Auswahl sagt, wen. Aufgaben mit Termin stehen auch in der **Agenda**.

## Kopieren und Verschieben
- Eine kopierte Aufgabe (Einfügen, Duplizieren, eine kopierte Seite oder Vorlage) ist eine **neue** Aufgabe; Ausschneiden und Einfügen **verschiebt** sie — Verknüpfungen auf sie funktionieren weiter.
- **Vorlage verwenden** startet ihre Aufgaben frisch: offen, ohne Termin und Erinnerung (Personen und Verknüpfungen bleiben).
- Dieselbe Aufgabe zweimal (eine alte Kopie) zeigt **DUPLIKAT** mit einer Taste **NEUE ID** — ein Klick, und sie ist eine eigene Aufgabe.
- Button-Vorlagen enthalten keine Aufgaben: Eine dort eingefügte Aufgabe bleibt als ihr Text erhalten.

## Aufgabe oder Datenbank?
Aufgaben stehen im Text, wo über die Arbeit gesprochen wird — ein Launch-Plan, Besprechungsnotizen, ein Briefing. Eine [Datenbank](help:databases) ist für Listen, die du sortierst, filterst und als Board oder Kalender ansiehst. To-do-Listen bleiben die leichte Checkliste — und die Schritte in einer Aufgabe.

## Dateien und Teilen
Markdown-Exporte und synchronisierte Dateien schreiben eine Aufgabe als `> [!TODO] Titel` plus eine Zeile mit ihren Feldern; ein in eine Datei getipptes `[!TODO]` kommt als Zitat zurück. Freigabelinks und die veröffentlichte Website zeigen Aufgaben eingefroren: Namen, keine IDs. Im Team-Arbeitsbereich gewinnt je Feld die letzte Änderung — weisen zwei Personen im selben Moment zu, bleibt unter Umständen nur eine Änderung; ein veralteter Tab kann bis zum Neuladen nur lesen.
