---
id: ai-menu
title: KI-Menü & Fragen
section: ai
order: 2
keywords: ki, claude, leertaste, ki fragen, verbessern, zusammenfassen, übersetzen, erklären, weiterschreiben, aufgaben, workspace fragen, in datenbank umwandeln, board, tabelle, hintergrund, ai, ask, database
related: claude-key, agent, command-palette, history
summary: Leertaste in einer leeren Zeile, oder „KI fragen“ an einer Auswahl — Claude schreibt, bearbeitet und antwortet direkt in der Seite.
---
## In einer leeren Zeile: Leertaste
Drück <kbd>Leertaste</kbd> in einer leeren Zeile (oder `/ki`). Tippe eine beliebige Bitte, oder wähle:
- **Schreiben** — **Weiterschreiben**, **Gliederung entwerfen…**, **Ideen sammeln…**
- **Diese Seite** — **Diese Seite zusammenfassen**, **Aufgaben auf dieser Seite finden**
- **Workspace** — **Workspace fragen**: Claude liest die passendsten Seiten dieses Workspace und zitiert sie; nur diese Auszüge werden gesendet.

## An einer Auswahl: KI fragen
Text markieren → **KI fragen** in der Werkzeugleiste. **Auswahl bearbeiten**: **Text verbessern**, **Rechtschreibung & Grammatik**, **Kürzer machen**, **Länger machen**, **Übersetzen**. **Verstehen**: **Erklären**, **Zusammenfassen**, **Aufgaben finden**.

Die Antwort erscheint fortlaufend. Dann **Auswahl ersetzen** (oder **Darunter einfügen**), **Überarbeiten** mit einer weiteren Anweisung, **Nochmal versuchen**, **Kopieren** oder **Verwerfen**. Bevor Claude eine Seite ändert, wird eine Version gesichert — siehe [Versionsverlauf](help:history).

## In Datenbank umwandeln
Markiere eine Liste, eine Tabelle oder einen Bericht aus mehreren Blöcken → **KI fragen** → **In Datenbank umwandeln**. Claude liest die Blöcke und schlägt eine Tabelle vor: die Einträge mit ihren Feldern (Status, Zuständige, Tags, Referenzcodes …), gruppiert nach den Überschriften, unter denen sie standen. Die Vorschau zeigt die Anzahl, die Spalten (was du nicht willst, schaltest du ab), **Gruppieren nach**, **Board** oder **Tabelle**, die ersten Einträge und was als Text bleibt — Einleitungen und Notizen behalten Formatierung und Links. **Umwandeln** (<kbd>Enter</kbd>) setzt die Datenbank an die Stelle der Liste; <kbd>Mod+Z</kbd> holt den Text in einem Schritt zurück (**Rückgängig** im Hinweis entfernt auch die Datenbank). Nichts wird erfunden: Was der Text nicht sagt, bleibt leer.

## Läuft im Hintergrund weiter
Eine Anfrage läuft weiter, wenn du das Feld schließt, in die Seitenleiste klickst oder eine andere Seite öffnest — nur **Stopp** und **Verwerfen** beenden sie. Die Seite zeigt sie unten an (**KI · Schreibt…**, dann **KI-Ergebnis fertig · Ansehen**), die Seitenleiste markiert die Seite mit einem Punkt, und ein Hinweis mit **Öffnen** meldet ein fertiges Ergebnis auf einer anderen Seite. Hat sich der Text inzwischen geändert, findet One ihn wieder; ist er weg, ist **Auswahl ersetzen** aus und **Darunter einfügen** setzt ans Ende der Seite. Ergebnisse warten auf diesem Gerät (auch nach dem Neuladen), bis du sie übernimmst oder verwirfst — höchstens 7 Tage, nie synchronisiert.

## ⌘K, dann ?
Tippe `?` in der Befehlspalette, um Claude zur geöffneten Seite zu fragen. Die Antwort an die Seite anhängen, als neue Seite anlegen oder kopieren.

> Anfragen gehen aus deinem Browser mit deinem Schlüssel an Anthropic. Hinzugefügte MCP-Server können bei freien Anfragen mitmachen — siehe [MCP-Server](help:mcp-servers).
