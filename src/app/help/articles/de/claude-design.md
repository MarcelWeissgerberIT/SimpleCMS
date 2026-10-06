---
id: claude-design
title: Von Claude Design zu One
section: share
order: 5
keywords: claude design, design, design tokens, design-tokens, stil, styleguide, palette, farben, schriften, schriftgrößen, radius, abstände, html-export, pptx-export, screenshot, mockup, prototyp, übergabe, #design, style, colours, fonts, handoff
related: import, memory, media-embeds, ai-menu
summary: Hol ein Design aus Claude Design nach One — seinen HTML- oder PPTX-Export und Screenshots — mit Farben, Schriften und Größen als Notiz und auf Wunsch im One-Gedächtnis.
---
Claude Design hat **keine direkte Verbindung** zu One: Es gibt keine Schnittstelle, bei der man sich anmelden könnte. Was es dir gibt, sind Exporte — eine **HTML**-Datei (eine Datei, Stile inline), eine **PowerPoint**-Präsentation — und Screenshots. One nimmt alle drei in einem Schritt: **Importieren** → **Claude Design**.

## Die drei Exporte
Füge sie in die Felder ein oder leg sie irgendwo auf dem Schritt ab — jede Datei landet in ihrem Feld.
- **HTML-Export** (`.html` oder ein `.zip` mit seinen Dateien): Der Inhalt kommt wie jede Webseite herein — Überschriften, Text, Listen, Tabellen, Bilder (Bilder in der Datei werden auf diesem Gerät gespeichert). Skripte und Formulare bleiben draußen; eingebettete SVG-Grafiken werden ausgelassen und im Importbericht genannt.
- **PPTX-Export** (`.pptx`): Die Präsentation wird eine eigene Seite unter der Design-Seite, bereit zum **Präsentieren** — was eine Präsentation mitbringt, steht unter [Importieren](help:import).
- **Screenshots** (PNG, JPEG, WebP — mehrere auf einmal): Sie kommen als Bilder unter der Überschrift **Screenshots** herein.

## Die Stil-Notiz
Aus dem CSS der HTML-Datei (Custom Properties, Inline-Stile, Google Fonts) und dem Design der Präsentation liest One die **Tokens** des Designs und zeigt sie vor dem Import: die Palette mit einer Rolle je Farbe (Hintergrund, Text, Primär, Akzent …), die Schriften für Überschriften, Fließtext und Code, die Schriftgrößen, die Radien und das Abstandsraster.
Auf der Seite stehen sie oben als geschlossener Aufklapper **Design-Tokens**: eine Tabelle mit Farbfeld, Hex-Code, Rolle und Token-Name je Farbe, danach Schriften, Größen, Radien und Abstände. Das Farbfeld zeigt die nächstliegende Farbe von One — der Hex-Code ist der echte.

## Screenshots mit Claude beschreiben
Setz den Haken bei **Screenshots mit Claude beschreiben** (braucht deinen [Claude-Schlüssel](help:claude-key)), und One fragt zuerst: Erst ein zweiter Druck auf **Senden & importieren** schickt jeden Screenshot an Anthropic. Claude schreibt Alternativtext und Bildunterschrift und liest den Text im Bild aus — er landet in einem Aufklapper **Text im Screenshot** darunter. Ohne Haken wird nichts gesendet.

## Den Stil im One-Gedächtnis behalten
Setz den Haken bei **Stil im One-Gedächtnis speichern** und gib ein Tag an (vorgeschlagen: `design-` + der Name). Der Stil wird als **Beispiel** in deinem [One-Gedächtnis](help:memory) gespeichert: die Stil-Notiz als Muster, die ersten Zeilen des Inhalts als Beispiel. Später nennst du es in einer Anfrage — *„schreib die Launch-Mail in #design-acme“* — im KI-Terminal oder im KI-Menü, und Claude schreibt und gestaltet in diesem Stil. Ein vorhandenes Tag wird ersetzt.

## Links auf ein Design
Ein geteilter Claude-Design-Link, in eine leere Zeile eingefügt, bietet zuerst **Lesezeichen** an: Die Seite lässt sich nicht einbetten, also wird sie eine Karte, die das Design in Claude öffnet.

> **Import rückgängig** im letzten Schritt entfernt die Seite, ihre Unterseite und den Gedächtnis-Eintrag in einem Schritt.
