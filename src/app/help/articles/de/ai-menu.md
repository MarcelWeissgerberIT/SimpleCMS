---
id: ai-menu
title: KI-Menü & Fragen
section: ai
order: 2
keywords: ki, claude, leertaste, ki fragen, verbessern, zusammenfassen, übersetzen, erklären, weiterschreiben, aufgaben, workspace fragen, in datenbank umwandeln, board, tabelle, hintergrund, kontext, was claude liest, blöcke markieren, neu machen, umschreiben, vorgaben, styleguide, ai, ask, database, context, redo
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

## Was Claude liest
Unter der Eingabe sagt eine Zeile, was von dieser Seite an Claude geht: **Liest · ganze Seite · 1.204 Wörter**, **3 markierte Blöcke · 412 Wörter** oder **nichts von dieser Seite** — dazu **Auswahl** bei Aktionen auf markiertem Text (die Auswahl wird immer gelesen). Ein Klick auf die Zeile (oder *kontext* tippen) bietet **Ganze Seite**, **Nur markierte Blöcke**, **Blöcke markieren…** und **Nichts von dieser Seite**.

**Blöcke markieren…** setzt neben jeden Block ein Kästchen und pausiert das Tippen: Klick oder <kbd>Leertaste</kbd> markiert, <kbd>Shift</kbd>-Klick markiert einen Bereich, <kbd>j</kbd> / <kbd>k</kbd> (oder Pfeile) bewegen, <kbd>a</kbd> alle, <kbd>n</kbd> keine, <kbd>Enter</kbd> fertig, <kbd>Esc</kbd> bricht ab. Das Feld kommt mit deiner Bitte zurück. Markierte Blöcke gehen als Markdown raus (Links und Erwähnungen bleiben lesbar); nicht markierter Text wird nie gesendet. Gibt es nichts zu lesen, fragen **Weiterschreiben** und **Diese Seite zusammenfassen** erst nach, statt zu senden. Markierungen gehören zu diesem Tab: Sie folgen deinen Änderungen und werden nie gespeichert oder synchronisiert. Das [KI-Terminal](help:agent) hält sich auch daran.

## In Datenbank umwandeln
Markiere eine Liste, eine Tabelle oder einen Bericht aus mehreren Blöcken → **KI fragen** → **In Datenbank umwandeln**. Claude liest die Blöcke und schlägt eine Tabelle vor: die Einträge mit ihren Feldern (Status, Zuständige, Tags, Referenzcodes …), gruppiert nach den Überschriften, unter denen sie standen. Die Vorschau zeigt die Anzahl, die Spalten (was du nicht willst, schaltest du ab), **Gruppieren nach**, **Board** oder **Tabelle**, die ersten Einträge und was als Text bleibt — Einleitungen und Notizen behalten Formatierung und Links. **Umwandeln** (<kbd>Enter</kbd>) setzt die Datenbank an die Stelle der Liste; <kbd>Mod+Z</kbd> holt den Text in einem Schritt zurück (**Rückgängig** im Hinweis entfernt auch die Datenbank). Nichts wird erfunden: Was der Text nicht sagt, bleibt leer.

## Neu machen mit Vorgaben
Markiere Stellen und lass Claude sie nach deinen Vorgaben neu machen: **KI fragen** → **Neu machen mit Vorgaben…** (auch im Blockmenü ⋮⋮ oder mit `/neu-machen` im KI-Terminal). Die Auswahl öffnet sich mit den markierten Blöcken — markiere weitere, auch weit auseinander (ganze Blöcke), dann <kbd>Enter</kbd>. Schreib, was anders werden soll — *kürzer, Du-Form, Fachbegriffe erklären* — und behalte es als Vorgabe-Chip fürs nächste Mal (bis zu 20, auf diesem Gerät; **⋯** benennt um oder löscht). Auf Wunsch kommt eine **Regeln-Seite** dazu (`@` im Feld): ein Styleguide oder Glossar, dessen Inhalt mitgeht. **Neu machen** (<kbd>Mod+Enter</kbd>) läuft wie jede Anfrage im Hintergrund; die Seite geht so mit, wie **Was Claude liest** es erlaubt.

Die Prüfung zeigt eine Stelle nach der anderen — entfernte Wörter durchgestrichen, neue unterstrichen: <kbd>y</kbd> oder <kbd>Enter</kbd> nimmt an, <kbd>n</kbd> lehnt ab, <kbd>j</kbd> / <kbd>k</kbd> bewegen, <kbd>a</kbd> nimmt alle an, <kbd>Esc</kbd> schließt (das Ergebnis wartet). Übernehmen schreibt alle angenommenen Stellen in einem Schritt — ein <kbd>Mod+Z</kbd> nimmt es zurück, vorher wird eine Version gesichert. Formatierung, Links und Erwähnungen bleiben. Eine Stelle, die du inzwischen geändert hast, wird übersprungen statt überschrieben; Bilder, Datenbanken, Einbettungen und andere Blöcke ohne Text ebenso.

## Läuft im Hintergrund weiter
Eine Anfrage läuft weiter, wenn du das Feld schließt, in die Seitenleiste klickst oder eine andere Seite öffnest — nur **Stopp** und **Verwerfen** beenden sie. Die Seite zeigt sie unten an (**KI · Schreibt…**, dann **KI-Ergebnis fertig · Ansehen**), die Seitenleiste markiert die Seite mit einem Punkt, und ein Hinweis mit **Öffnen** meldet ein fertiges Ergebnis auf einer anderen Seite. Hat sich der Text inzwischen geändert, findet One ihn wieder; ist er weg, ist **Auswahl ersetzen** aus und **Darunter einfügen** setzt ans Ende der Seite. Ergebnisse warten auf diesem Gerät (auch nach dem Neuladen), bis du sie übernimmst oder verwirfst — höchstens 7 Tage, nie synchronisiert.

## ⌘K, dann ?
Tippe `?` in der Befehlspalette, um Claude zur geöffneten Seite zu fragen. Die Antwort an die Seite anhängen, als neue Seite anlegen oder kopieren.

> Anfragen gehen aus deinem Browser mit deinem Schlüssel an Anthropic. Hinzugefügte MCP-Server können bei freien Anfragen mitmachen — siehe [MCP-Server](help:mcp-servers).
