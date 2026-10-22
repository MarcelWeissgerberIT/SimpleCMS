---
id: blocks
title: Blöcke & Slash-Menü
section: writing
order: 1
keywords: slash, block, einfügen, überschrift, liste, to-do, hinweisbox, zitat, code, trennlinie, markdown, bild, einbetten, blocks, slash menu, Aufgabe, task
related: block-handle, layout-blocks, media-embeds, mentions-dates, tasks
summary: Alles auf einer Seite ist ein Block. Tippe / zum Einfügen — oder nutze Markdown-Kürzel.
---
Tippe `/` in einer leeren Zeile (oder nach einem Leerzeichen) und schreib weiter, um zu filtern: `/aufgabe`, `/checkliste`, `/tabelle`, `/board`, `/diagramm`. <kbd>↑</kbd> <kbd>↓</kbd> wählen, <kbd>Enter</kbd> fügt ein, <kbd>Esc</kbd> bricht ab. `/aufgabe` legt eine [Aufgabe](help:tasks) an, `/checkliste` eine To-do-Liste. Englische Namen gehen auch: `/todo`, `/task`, `/table`.

Das Menü ist gruppiert: **Basis** (Text, Überschriften, Seite, Link zur Seite, Hinweisbox, Zitat, Trennlinie, Tabelle, Tabellenkalkulation, Diagramm), **Listen** (Aufzählung, nummeriert, To-do, [Aufgabe](help:tasks), Aufklapplisten), **Medien** (Bild, Lesezeichen, Einbetten, PDF, Datei, Video, Audio), **Datenbank** (Tabellen-, Board-, Listen-, Galerie-, Kalenderansicht, Zeitleiste, Diagrammansicht, Formular, verknüpfte Datenbank), **Erweitert** (Code, Formeln, Mermaid-Diagramme, Inhaltsverzeichnis, Brotkrumen, 2 bis 5 Spalten, Tabs, synchronisierter Block, Schaltfläche), **Im Text** (Erwähnung, Datum, Emoji, Icon, Formel im Text) und **KI** (KI fragen, Besprechungsnotizen).

Ein Mermaid-Diagramm musst du nicht tippen: Markiere eine Liste von Schritten → **KI fragen** → **Verwandeln in …** → **Schaubild** ([KI-Menü & Fragen](help:ai-menu)).

Zu breit für die Seite? **Groß öffnen** — die ↗-Taste am Schaubild, sein Blockmenü oder ein Doppelklick — zeigt es über den ganzen Bildschirm, mit Zoom, Verschieben und Minikarte ([Diagramme](help:charts)).

Für Skizzen-Diagramme und Illustrationen gibt es `/handdrawn` → **Handgezeichnet**. Diagramme bleiben bearbeitbar; Illustrationen nutzen einen verbundenen Bilddienst. Beides lässt sich als Cover übernehmen ([Handgezeichnet](help:hand-drawn)).

## Markdown-Kürzel
Am Zeilenanfang tippen:
- `# `, `## `, `### ` — Überschriften
- `- ` oder `* ` — Aufzählung, `1. ` — nummerierte Liste, `[] ` — To-do, `[!] ` — eine [Aufgabe](help:tasks)
- `> ` — Zitat, `>> ` — Aufklappliste, `!> ` — Hinweisbox
- ```` ``` ```` — Codeblock, `$$ ` — Formel, `---` — Trennlinie

**Codeblöcke** nummerieren ihre Zeilen ab vier Zeilen und lassen jede Zeile in einer Reihe (lange Zeilen scrollen); die Tasten in ihrer Leiste schalten Zeilennummern und **Zeilen umbrechen** für diesen Block auf diesem Gerät, **Kopieren** kopiert den Code, und ein JSON-Block sagt, ob er gültig ist — oder wo der erste Fehler steckt. <kbd>Mod+A</kbd> im Block markiert zuerst seinen Code. *One Script* ist eine der Sprachen.

Markierter Text zeigt die Werkzeugleiste: fett, kursiv, unterstrichen, durchgestrichen, Code, Link, Farbe, **KI fragen** und **Kommentieren**.

> Ein eingefügter Link lässt sich als Link behalten oder in ein Lesezeichen, eine Einbettung oder einen Player verwandeln.

## Einrichtungs- und Download-Buttons

Ein Button kann **Worker einrichten / herunterladen** öffnen. Er öffnet deine persönlichen Coding-Worker-Einstellungen; der Download dort koppelt den Worker mit deinem Konto und aktuellen Workspace. Der Button selbst erzeugt keinen Token und startet keinen Auftrag. Codeblöcke haben eine Taste **Kopieren**, die den Befehl kopiert, ohne ihn auszuführen.

Auf einer übersetzten Live-Seite können berechtigte Mitglieder Navigation und Worker-Einrichtung nutzen. Buttons, die Inhalte ändern, bleiben in dieser Übersetzungsansicht deaktiviert. Gesperrte Seiten, reine Gast-Lesezugänge und statische Freigaben erhalten keine neuen Aktionen.
