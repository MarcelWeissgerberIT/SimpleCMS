---
id: import
title: Importieren
section: share
order: 4
keywords: import, importieren, notion, obsidian, evernote, trello, markdown, csv, html, confluence, google docs, powerpoint, pptx, präsentation, folien, keynote, claude design, umziehen, migrieren
related: export, databases, first-steps, claude-design
summary: Zieh um aus Notion, Obsidian, Evernote, Trello, Markdown, CSV, Webseiten oder PowerPoint.
---
**Importieren** in der Seitenleiste (oder ⌘K → *Importieren*). Dateien, Ordner oder ZIPs ablegen — das Format wird erkannt.

- **Notion** — *Einstellungen → Exportieren → „Markdown & CSV“* mit Unterseiten; ZIP unverändert ablegen. Datenbanken kommen als echte Datenbanken mit Eigenschaften an.
- **Obsidian-Vault** — Vault-Ordner wählen oder als ZIP ablegen. Links, Einbettungen und Callouts bleiben erhalten.
- **Evernote** — Notizbücher als `.enex` exportieren; jede Datei wird eine Seite mit ihren Notizen.
- **Trello-Board** — Board-Menü → *Drucken, exportieren und teilen → Als JSON exportieren*.
- **Webseiten** — HTML-Dateien oder ein ZIP: Google Docs (Webseite), Confluence, Dropbox Paper.
- **Markdown & Text** — einzelne Dateien oder ganze Ordner; Front Matter wird zur Eigenschaftszeile.
- **Tabelle** — CSV oder TSV: Die erste Spalte ist der Titel, Spaltentypen werden erkannt.
- **PowerPoint** — eine `.pptx`-Präsentation (siehe unten).
- **Claude Design** — sein HTML- oder PPTX-Export und Screenshots: [Von Claude Design zu One](help:claude-design).
- **One-Backup** — ein `.json`-Backup: zusammenführen oder den Workspace ersetzen.

Jeder Import landet unter einer Seite: Verschiebe sie beliebig — oder leg sie in den Papierkorb, um den Import rückgängig zu machen. Ein **Importbericht** listet, was sich nicht übernehmen ließ.

> CSV in eine bestehende Datenbank: Datenbank **•••** → **CSV in diese Datenbank importieren…**

## PowerPoint-Präsentationen
Wähle die Kachel **PowerPoint** oder leg eine `.pptx` ab. Sie wird auf diesem Gerät gelesen — nichts wird gesendet. Zuerst kommt eine **Vorschau**: die Folien mit ihren Titeln, wie viele Bilder, Tabellen und Notizen, und was nicht 1:1 mitkommt. Seitentitel und Aufbau wählen, dann **Importieren**.
- **Eine Seite** (Standard): eine Überschrift und ein Trenner je Folie. **Präsentieren** im letzten Schritt zeigt sie Folie für Folie — jede PowerPoint-Folie ist genau eine Folie. Eine Titelfolie wird zum Seitentitel und zur Zeile darunter.
- **Eine Seite je Folie**: Jede Folie wird eine eigene Unterseite, unter einer Seite mit dem Titel der Präsentation.
- **Übernommen:** Titel, Text, Aufzählungen mit ihren Ebenen, fett / kursiv / unterstrichen / durchgestrichen, Links, Tabellen, Bilder (auf diesem Gerät gespeichert), Sprechernotizen als geschlossener Aufklapper **Notizen** unter der Folie.
- **Nicht 1:1:** Ein Diagramm kommt als Tabelle mit seinen Daten, SmartArt als Liste ihres Texts; Video, Audio, eingebettete Objekte und Bilder in EMF / WMF / TIFF bleiben draußen — der Importbericht sagt es.
- **Import rückgängig** im letzten Schritt entfernt den ganzen Import in einem Schritt.
- Grenzen: höchstens 300 Folien und 200 MB entpackt. Alte `.ppt`-Dateien zuerst als `.pptx` speichern.

Eine `.pptx`, die schon auf einer Seite liegt (dort abgelegt oder ein Mail-Anhang): Ihre Dateitaste **KI** → **Als Seite öffnen** macht dasselbe hier auf dem Gerät; **Zusammenfassen** und **Frage zur Datei** senden ihren Text an Claude.
