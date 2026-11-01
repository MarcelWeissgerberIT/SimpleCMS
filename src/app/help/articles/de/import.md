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

## Externe Quellen: URL, PDF und formatierter Text

Öffne **Importieren → Externe Quelle**. Unter **URL** gibst du eine öffentliche HTTPS-Adresse ein und wählst **Vorschau laden**. ONE liest genau diese Quelle über deinen Teamserver; deine Browser-Cookies und Anmeldungen gehen nicht mit. Der URL-Abruf benötigt einen angemeldeten Team-Workspace. **Text einfügen** funktioniert auch lokal und ist der Weg für geschützte oder dynamische Seiten. Vorhandene Dateiimporte bleiben verfügbar.

Prüfe Titel und Originaltext, wähle bei Bedarf einen Auszug und notiere, wofür du die Quelle nutzen möchtest. Erst mit **Vorschau geprüft** wird **Quelle übernehmen** aktiv. Es entsteht eine normale ONE-Seite mit Quellenadresse, Zeitpunkt und Inhalts-Hash. Bekannte Token-Parameter werden aus dem gespeicherten Quellenlink entfernt. Ein Import ruft keine KI auf und schreibt nichts nach Atlas.

**PDF:** Wähle die PDF-Kachel im Quellenimport und eine lokale Datei bis 20 MB / 200 Seiten. Wähle die Originalseiten aus und prüfe den ausgelesenen Text. Originaldatei, Datei-Hash und ursprüngliche Seitenzahlen bleiben erhalten. Scans ohne Text brauchen OCR; ONE ergänzt keine erfundenen Inhalte. Bis zur Übernahme wird die PDF nur auf diesem Gerät gelesen.

**Formatierte Zwischenablage:** Füge unter **Text einfügen** mit Strg+V / ⌘V ein. Tabellen, Listen, Hervorhebungen und Links bleiben in der Vorschau und auf der Seite erhalten. Bilder, Skripte und fremde Seitenfunktionen werden entfernt. **Als reinen Text bearbeiten** löst die Formatierung bewusst auf und erlaubt einen kleineren Auszug.

Die Quelle bleibt eine **externe Referenz**, keine bestätigte Anforderung. Du kannst sie als Kontext für eine KI-Aufgabe nutzen. Für die direkte Übergabe wähle nach dem Import **Atlas-Übergabe prüfen** oder auf der Seite **••• → Als Quelle nach Atlas übergeben…**:

1. Wähle deine persönliche Atlas-Verbindung und **Zugang und Projekte prüfen**. Die Verbindung braucht einen erreichbaren persönlichen Worker bzw. einen vorhandenen MCP-Zugang über den Teamserver.
2. Wähle ausdrücklich eines der tatsächlich von Atlas gelieferten Projekte. Prüfe Titel und Auszug (höchstens 18.000 Zeichen; der vollständige Aufruf einschließlich Metadaten und Maskierung muss in 20.000 Zeichen passen).
3. **Vorgaben und Übergabe prüfen** liest die Atlas-Constraints und zeigt die exakten ausgehenden Daten samt Prüfsumme. Es wird noch nichts geschrieben.
4. Prüfe diese Vorschau und bestätige **Jetzt in Atlas anlegen**. Es entsteht ein neues Dossier (`doc`) mit ONE-Quellenlink und Inhalts-Hash. Keine bestehenden Records werden überschrieben; es entstehen keine bestätigten Requirements oder Entscheidungen.
5. Der Nachweis nennt die tatsächlich von Atlas zurückgegebene Ref und das Ergebnis der Rückleseprüfung. Lade ihn bei Bedarf herunter. Bei verlorener Antwort prüfe zuerst Atlas; ONE wiederholt Schreibversuche nicht automatisch. Ein persönlicher lokaler Nachweis sperrt denselben Inhalt auch nach Schließen oder Neuladen des Dialogs. Bei einem ungeklärten Versuch zuerst Atlas prüfen; erst nach bewusster Bestätigung eines fehlenden Datensatzes neu vorbereiten. Lokal werden nur Hashes und zurückgegebene Refs gespeichert, kein Quelltext und kein Token.

Die Übergabe nutzt keine KI, keinen fremden Token und keine zusätzlichen Rechte. Bestehende Datenausgangsregeln, Werkzeugfreigaben und Atlas-Vorgaben gelten weiterhin. Bei verweigertem Zugang oder fehlendem Projekt muss der persönliche Zugang angepasst werden.

URL-Importe lesen statischen Text bis 2 MB; Tabellen kommen dabei als Text. PDF-Dateien werden über die PDF-Kachel statt über den URL-Abruf eingelesen. Bei Login oder dynamischen Seiten nutze die Zwischenablage. Die geprüfte Textauswahl ist auf 250.000 Zeichen begrenzt. **Import rückgängig** entfernt den ONE-Import; eine bereits bewusst angelegte Atlas-Referenz bleibt in Atlas.

## PowerPoint-Präsentationen
Wähle die Kachel **PowerPoint** oder leg eine `.pptx` ab. Sie wird auf diesem Gerät gelesen — nichts wird gesendet. Zuerst kommt eine **Vorschau**: die Folien mit ihren Titeln, wie viele Bilder, Tabellen und Notizen, und was nicht 1:1 mitkommt. Seitentitel und Aufbau wählen, dann **Importieren**.
- **Eine Seite** (Standard): eine Überschrift und ein Trenner je Folie. **Präsentieren** im letzten Schritt zeigt sie Folie für Folie — jede PowerPoint-Folie ist genau eine Folie. Eine Titelfolie wird zum Seitentitel und zur Zeile darunter.
- **Eine Seite je Folie**: Jede Folie wird eine eigene Unterseite, unter einer Seite mit dem Titel der Präsentation.
- **Übernommen:** Titel, Text, Aufzählungen mit ihren Ebenen, fett / kursiv / unterstrichen / durchgestrichen, Links, Tabellen, Bilder (auf diesem Gerät gespeichert), Sprechernotizen als geschlossener Aufklapper **Notizen** unter der Folie.
- **Nicht 1:1:** Ein Diagramm kommt als Tabelle mit seinen Daten, SmartArt als Liste ihres Texts; Video, Audio, eingebettete Objekte und Bilder in EMF / WMF / TIFF bleiben draußen — der Importbericht sagt es.
- **Import rückgängig** im letzten Schritt entfernt den ganzen Import in einem Schritt.
- Grenzen: höchstens 300 Folien und 200 MB entpackt. Alte `.ppt`-Dateien zuerst als `.pptx` speichern.

Eine `.pptx`, die schon auf einer Seite liegt (dort abgelegt oder ein Mail-Anhang): Ihre Dateitaste **KI** → **Als Seite öffnen** macht dasselbe hier auf dem Gerät; **Zusammenfassen** und **Frage zur Datei** senden ihren Text an Claude.
