---
id: ai-menu
title: KI-Menü & Fragen
section: ai
order: 2
keywords: ki, claude, leertaste, ki fragen, verbessern, zusammenfassen, übersetzen, erklären, weiterschreiben, aufgaben, workspace fragen, in datenbank umwandeln, board, tabelle, verwandeln in, schaubild, flussdiagramm, mindmap, mermaid, diagramm, zeitleiste, spalten, tabs, aufklappliste, karten, visualisieren, hintergrund, kontext, was claude liest, blöcke markieren, neu machen, umschreiben, vorgaben, styleguide, bild, foto, alternativtext, bildunterschrift, text auslesen, ocr, bild in tabelle, screenshot, ai, ask, database, transform, diagram, chart, context, redo, image
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

## One-Gedächtnis
Eigene Anfragen nehmen das [One-Gedächtnis](help:memory) mit: **GEDÄCHTNIS · 3** unter *Liest* zeigt, welche Erinnerungen mitgehen — ein Klick zeigt die Liste, den **Verlauf** und einen Schalter für diese Anfrage. Beginnt eine Anfrage mit *merk dir …* (oder *remember …*), macht Claude daraus einen Vorschlag fürs Gedächtnis statt einer Antwort; an einer Auswahl tut **Ins Gedächtnis …** dasselbe, und **Als Beispiel merken …** behält die Blöcke als Beispiel. Nenne ein Beispiel — `#wochenbericht` — und Claude baut darauf auf.

## In Datenbank umwandeln
Markiere eine Liste, eine Tabelle oder einen Bericht aus mehreren Blöcken → **KI fragen** → **In Datenbank umwandeln**. Claude liest die Blöcke und schlägt eine Tabelle vor: die Einträge mit ihren Feldern (Status, Zuständige, Tags, Referenzcodes …), gruppiert nach den Überschriften, unter denen sie standen. Die Vorschau zeigt die Anzahl, die Spalten (was du nicht willst, schaltest du ab), **Gruppieren nach**, **Board** oder **Tabelle**, die ersten Einträge und was als Text bleibt — Einleitungen und Notizen behalten Formatierung und Links. **Umwandeln** (<kbd>Enter</kbd>) setzt die Datenbank an die Stelle der Liste; <kbd>Mod+Z</kbd> holt den Text in einem Schritt zurück (**Rückgängig** im Hinweis entfernt auch die Datenbank). Nichts wird erfunden: Was der Text nicht sagt, bleibt leer. **Platzierung**: **Hier (inline)** (Standard) oder **Als eigene Seite (verlinkt)** — eine ganzseitige Datenbank unter dieser Seite, verlinkt an der Stelle der Liste.

## Verwandeln in
Markiere ein paar Blöcke — Schritte, Zahlen, einen Vergleich, Fragen und Antworten — → **KI fragen** → **Verwandeln in …** (auch im Blockmenü ⋮⋮ mehrerer markierter Blöcke). Wähle die Form:
- **Automatisch** — Claude wählt die passende Form und sagt in einer Zeile, warum.
- **Board**, **Tabelle** — die Datenbank von **In Datenbank umwandeln**, mit ihrer Vorschau und der **Platzierung**. **Zeitleiste** — dasselbe mit den Daten aus dem Text, geöffnet in einer Zeitleisten-Ansicht.
- **Schaubild** — ein Mermaid-Flussdiagramm, eine Mindmap, ein Ablauf, Zeitstrahl, Gantt oder Organigramm. Die Beschriftungen sind kurz: Claude kürzt deine eigenen Worte.
- **Diagramm** — Säulen, Linie, Fläche oder Ring aus den Zahlen im Text, als eingegebene Daten eines [Diagramms](help:charts).
- **Spalten** (2–5), **Tabs**, **Aufklappliste**, **Karten** — derselbe Text nebeneinander, hinter Reitern, eingeklappt oder als Hinweisboxen ([Aufklapper, Spalten & Tabs](help:layout-blocks)).

Die Vorschau zeigt das echte Ergebnis — das Schaubild gezeichnet, das Diagramm gerendert, Spalten als Spalten. Die Leiste oben wechselt die Form (<kbd>←</kbd> / <kbd>→</kbd> in der leeren Eingabe); eine schon angefragte Form kommt ohne neue Anfrage zurück. Kleine Optionen: Art und Richtung des Schaubilds, Art des Diagramms, Zahl der Spalten. **Nicht übernommen** zeigt, was als Text bleibt, und jede Zahl, die Claude nennt, die aber nicht im Text steht — sie wird weggelassen. **Verwandeln** (<kbd>Enter</kbd>) setzt das Ergebnis in einem Schritt an die Stelle der Blöcke: <kbd>Mod+Z</kbd> holt den Text zurück, vorher wird eine Version gesichert. **Original darunter behalten (zugeklappt)** legt die Ausgangsblöcke in eine geschlossene Aufklappliste unter den neuen Block.

Nichts wird erfunden: Namen, Zahlen, Daten und Schritte kommen nur aus dem Text. Ein Schaubild, das Mermaid nicht lesen kann, wird einmal automatisch korrigiert, sonst kommt ein Fehler — es ändert sich nichts. Nur die markierten Blöcke gehen an Claude, nie das One-Gedächtnis; die Anfrage läuft wie jede andere im Hintergrund weiter.

## In Seite umwandeln
**KI fragen** → **Strukturieren** → **In Seite umwandeln** verschiebt die markierten Blöcke sofort in eine neue Unterseite — ohne Claude — und lässt an ihrer Stelle einen Link. Dasselbe im Blockmenü ⋮⋮ (**Umwandeln in → Seite**) und mit <kbd>Mod+Alt+9</kbd>; siehe [Ziehen, umwandeln, färben](help:block-handle).

## Neu machen mit Vorgaben
Markiere Stellen und lass Claude sie nach deinen Vorgaben neu machen: **KI fragen** → **Neu machen mit Vorgaben…** (auch im Blockmenü ⋮⋮ oder mit `/neu-machen` im KI-Terminal). Die Auswahl öffnet sich mit den markierten Blöcken — markiere weitere, auch weit auseinander (ganze Blöcke), dann <kbd>Enter</kbd>. Schreib, was anders werden soll — *kürzer, Du-Form, Fachbegriffe erklären* — und behalte es als Vorgabe-Chip fürs nächste Mal (bis zu 20, auf diesem Gerät; **⋯** benennt um oder löscht). Auf Wunsch kommt eine **Regeln-Seite** dazu (`@` im Feld): ein Styleguide oder Glossar, dessen Inhalt mitgeht. **Neu machen** (<kbd>Mod+Enter</kbd>) läuft wie jede Anfrage im Hintergrund; die Seite geht so mit, wie **Was Claude liest** es erlaubt.

Die Prüfung zeigt eine Stelle nach der anderen — entfernte Wörter durchgestrichen, neue unterstrichen: <kbd>y</kbd> oder <kbd>Enter</kbd> nimmt an, <kbd>n</kbd> lehnt ab, <kbd>j</kbd> / <kbd>k</kbd> bewegen, <kbd>a</kbd> nimmt alle an, <kbd>Esc</kbd> schließt (das Ergebnis wartet). Übernehmen schreibt alle angenommenen Stellen in einem Schritt — ein <kbd>Mod+Z</kbd> nimmt es zurück, vorher wird eine Version gesichert. Formatierung, Links und Erwähnungen bleiben. Eine Stelle, die du inzwischen geändert hast, wird übersprungen statt überschrieben; Bilder, Datenbanken, Einbettungen und andere Blöcke ohne Text ebenso.

## Claude für Bilder
Fahr über ein Bild (am Handy: tipp es an) und drück die Taste **KI** in seiner Leiste — oder öffne das Blockmenü ⋮⋮ (<kbd>Alt+Enter</kbd>) → **Claude**. **KI fragen** an einer Auswahl mit genau einem Bild zeigt sie ebenfalls:
- **Bild beschreiben** — Claude schlägt einen **Alternativtext** (ein kurzer Satz) und eine **Bildunterschrift** (eine Zeile) vor. Im Panel anpassen, dann **Alternativtext + Bildunterschrift übernehmen** — ein Schritt, ein <kbd>Mod+Z</kbd>.
- **Text auslesen** — alles, was im Bild steht, als Markdown (Überschriften, Listen und Tabellen bleiben, der Text wie geschrieben, nicht übersetzt) → **Unter dem Bild einfügen**.
- **Bild → Tabelle** — jede Tabelle im Bild (eine Volumentabelle, ein Zeitplan, ein Platten-Layout …) mit Kopfzeile → **Als Tabelle einfügen** (ein Block pro Tabelle), **Als Tabellenkalkulation einfügen** (ein Blatt pro Tabelle, Zahlen als Zahlen) oder, bei genau einer Tabelle, **Als Datenbank …** (die Vorschau von [In Datenbank umwandeln](help:ai-menu), dann **Datenbank unter dem Bild anlegen**).
- **Frage zum Bild …** — eine beliebige Frage tippen; die Antwort läuft ein → **Unter dem Bild einfügen** oder **Kopieren**.

Das Bild geht nur mit diesen Aktionen an Anthropic, verkleinert auf höchstens 1568 px und 5 MB (ein GIF als erstes Bild, ein SVG als Pixel); die Seite geht mit, soweit **Was Claude liest** es erlaubt. Sie laufen im Hintergrund wie jede Anfrage. Ein Webbild, dessen Website One das Lesen nicht erlaubt (CORS), lässt sich nicht senden — das Panel sagt es und bietet **Kopie hochladen …** an. Im [KI-Terminal](help:agent) fügt <kbd>Mod+Shift+J</kbd> auf einem ausgewählten Bild es als Chip hinzu (**▣ … · Bild 1,2 MB**); die nächste Aufgabe schickt das Bild mit.

## Läuft im Hintergrund weiter
Eine Anfrage läuft weiter, wenn du das Feld schließt, in die Seitenleiste klickst oder eine andere Seite öffnest — nur **Stopp** und **Verwerfen** beenden sie. Die Seite zeigt sie unten an (**KI · Schreibt…**, dann **KI-Ergebnis fertig · Ansehen**), die Seitenleiste markiert die Seite mit einem Punkt, und ein Hinweis mit **Öffnen** meldet ein fertiges Ergebnis auf einer anderen Seite. Hat sich der Text inzwischen geändert, findet One ihn wieder; ist er weg, ist **Auswahl ersetzen** aus und **Darunter einfügen** setzt ans Ende der Seite. Ergebnisse warten auf diesem Gerät (auch nach dem Neuladen), bis du sie übernimmst oder verwirfst — höchstens 7 Tage, nie synchronisiert.

## ⌘K, dann ?
Tippe `?` in der Befehlspalette, um Claude zur geöffneten Seite zu fragen. Die Antwort an die Seite anhängen, als neue Seite anlegen oder kopieren.

> Anfragen gehen aus deinem Browser mit deinem Schlüssel an Anthropic. Hinzugefügte MCP-Server können bei freien Anfragen mitmachen — siehe [MCP-Server](help:mcp-servers).
