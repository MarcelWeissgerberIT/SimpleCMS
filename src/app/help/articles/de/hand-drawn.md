---
id: hand-drawn
title: Handgezeichnete Diagramme und Illustrationen
section: writing
order: 16
keywords: handgezeichnet, zeichnen, Skizze, Sketchnote, Illustration, Diagramm, Orange, Schwarz, Cover, Referenzbild, hand drawn, hand-drawn
related: blocks, charts, mcp-servers, ai-providers
summary: Bearbeitbare Skizzen-Diagramme oder Illustrationen im Orange-Schwarz-Stil von One erstellen.
---
Tippe `/handdrawn` und wähle **Handgezeichnet**. Das Fenster hat zwei Varianten: **Diagramm** und **Illustration**. Es beginnt mit einer Vorschau; deine Seite ändert sich erst mit **Block einfügen**, **Änderungen übernehmen** oder **Als Cover übernehmen**.

## Diagramm
Das Beispiel funktioniert ohne KI-Schlüssel. Unter **Diagrammdaten bearbeiten** änderst du Beschriftungen und Pfeile. Für KI-Unterstützung beschreibst du das gewünschte Bild und wählst **Vorschau erzeugen**. Die Anbieter- und Modellauswahl gilt für diesen Auftrag; auch ein eingerichtetes lokales Textmodell kann Diagramme erzeugen. Bei ungültigen KI-Diagrammdaten gibt es höchstens einen Korrekturversuch.

Der eingefügte Block behält seine bearbeitbaren Mermaid-Daten und den Skizzenstil. **Zeichnung bearbeiten** öffnet das Fenster erneut; **Groß öffnen** zeigt das Vektordiagramm mit Zoom, Verschieben und SVG-Download. **Als Cover übernehmen** speichert einen SVG-Schnappschuss; spätere Änderungen am Diagramm ändern dieses Cover nicht automatisch.

## Illustration
Wähle einen verbundenen **Bilddienst · MCP**, beschreibe das Motiv und wähle ein Format: quadratisch, 16:9 oder **3:1 · Cover**. Beim Cover-Format soll der Dienst Gesichter und wichtige Formen im mittleren Streifen halten und auf Beschriftungen verzichten. One ergänzt den Auftrag um schwarze Tintenlinien, orange Marker-Akzente und Papierhintergrund.

Die Erzeugung braucht eine eingerichtete KI-Verbindung mit MCP-Unterstützung und einen verbundenen Bilddienst. Ein Coding-Modell allein erzeugt keine Bilder. Die Modell- und die Bilddienstauswahl steuern unterschiedliche Teile des Auftrags. Beide Dienste können Nutzungskosten verursachen; die normalen Datenregeln, Kostenerfassung und Budgetkontrollen von One gelten weiter.

Ergebnisse erscheinen als Medienkarten. Externe Bilder werden nicht automatisch geladen. **In One speichern** prüft und speichert die Datei für die Vorschau; danach kannst du sie einfügen oder als Cover übernehmen. Blockiert ein Anbieter den Download, bietet die Karte **Kopie hochladen** und im Team-Arbeitsbereich **Über den Team-Server laden** an.

## Seitenkontext und Referenzen
**Diese Seite als Kontext verwenden** ist anfangs aus. Ist es eingeschaltet, nutzt One nur den freigegebenen KI-Kontext der Seite und wendet die Datenregeln der gewählten Verbindung an. Andere Seiten, Atlas und das One-Gedächtnis werden für diesen Block nicht durchsucht.

Ein optionales PNG-, JPEG- oder WebP-Referenzbild bis 10 MB wird im Arbeitsbereich gespeichert. Beim **Vorschau erzeugen** betrachtet das gewählte KI-Modell die Referenz und beschreibt sie; der Bilddienst erhält diese Beschreibung. Das ist eine visuelle Orientierung, keine zugesicherte pixelgenaue Bearbeitung oder exakte Ähnlichkeit.

Auftrag, Format, Dienstauswahl und lokale Referenz bleiben beim eingefügten Bild im Arbeitsbereich und in Arbeitsbereich-Backups erhalten. Gewöhnliche HTML- und Markdown-Exporte lassen diese Erzeugungsdaten und die ursprüngliche Referenz weg. Die sichtbare Zeichnung wird normal exportiert. Beim erneuten Öffnen einer Illustration bleibt der Auftrag erhalten, der das ausgewählte Bild erzeugt hat; eine Textänderung allein erzeugt kein neues Bild.
