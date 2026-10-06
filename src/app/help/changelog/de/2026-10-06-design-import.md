---
id: 2026-10-06-design-import
date: 2026-10-06
order: 5
title: PowerPoint-Import und „Aus Claude Design übernehmen“
summary: Hol eine .pptx-Präsentation als Seite herein, die du präsentieren kannst, und einen Claude-Design-Export mit Farben, Schriften und Größen als Notiz — und im One-Gedächtnis.
image: assets/shots/changelog/design-import.webp
alt: Der Claude-Design-Schritt im Import-Dialog mit HTML-Export, PowerPoint-Präsentation und einem Screenshot; darunter die daraus gelesenen Design-Tokens als Farbfelder mit Hex-Code und Rolle und die Optionen, die Screenshots zu beschreiben und den Stil im One-Gedächtnis zu speichern
help: claude-design, import, memory
---
**Importieren** hat zwei neue Quellen:

- **PowerPoint** — leg eine `.pptx` ab: Zuerst kommt eine Vorschau der Folien, Bilder, Tabellen und Notizen, dann eine Seite mit einer Überschrift je Folie (oder eine Seite je Folie). Sprechernotizen werden zum Aufklapper **Notizen**, Diagramme zu einer Tabelle ihrer Daten. **Präsentieren** zeigt sie Folie für Folie. Gelesen auf deinem Gerät; **Import rückgängig** nimmt alles in einem Schritt zurück.
- **Claude Design** — es hat keine direkte Verbindung, also nimmt One, was es exportiert: die **HTML**-Datei, die **PPTX**-Präsentation und Screenshots. Der Inhalt kommt herein, und Palette, Schriften, Schriftgrößen, Radien und Abstände des Designs landen oben als Notiz **Design-Tokens**.

Setz den Haken bei **Screenshots mit Claude beschreiben** für Alternativtext, Bildunterschrift und den Text in jedem Bild (One fragt, bevor etwas gesendet wird). Setz den Haken bei **Stil im One-Gedächtnis speichern**, und später lässt *„#design-acme“* in einer Anfrage Claude in diesem Stil schreiben.

> Tipp: Eine `.pptx`, die schon auf einer Seite liegt — ihre Taste **KI** → **Als Seite öffnen**. Ein eingefügter Claude-Design-Link wird eine Lesezeichen-Karte.
