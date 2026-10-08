---
id: ai-menu
title: KI-Menü & Fragen
section: ai
order: 2
keywords: ki, claude, leertaste, ki fragen, verbessern, zusammenfassen, übersetzen, erklären, weiterschreiben, aufgaben, workspace fragen, in datenbank umwandeln, board, tabelle, verwandeln in, schaubild, flussdiagramm, mindmap, mermaid, diagramm, zeitleiste, spalten, tabs, aufklappliste, karten, visualisieren, hintergrund, kontext, was claude liest, blöcke markieren, neu machen, umschreiben, vorgaben, styleguide, unterseite pro eintrag, seiten + tabelle, unterseite daraus, eine seite pro ticket, bild, foto, alternativtext, bildunterschrift, text auslesen, ocr, bild in tabelle, screenshot, datei, pdf, anhang, pdf zusammenfassen, word, docx, excel, xlsx, csv, html, als seite öffnen, als datenbank importieren, ai, ask, database, transform, diagram, chart, context, redo, image
related: claude-key, agent, command-palette, history
summary: Leertaste in einer leeren Zeile, oder „KI fragen“ an einer Auswahl — Claude schreibt, bearbeitet und antwortet direkt in der Seite.
---
Das Menü beginnt mit dem Eingabefeld: frag in eigenen Worten und drück <kbd>Enter</kbd>. Darunter die Aktionen, die du für das Geöffnete am häufigsten brauchst — Text, mehrere Blöcke, ein Bild, eine Datei oder eine leere Zeile; **Übersetzen**, **Verwandeln in …** und **Mehr…** öffnen ein Untermenü (<kbd>→</kbd>, zurück mit <kbd>←</kbd> oder <kbd>Rücktaste</kbd>). **Mehr…** hat alles Übrige. Tippen durchsucht jede Aktion, egal wo sie steht.

## In einer leeren Zeile: Leertaste
Drück <kbd>Leertaste</kbd> in einer leeren Zeile (oder `/ki`). Tippe eine beliebige Bitte, oder wähle:
- **Schreiben** — **Weiterschreiben**, **Gliederung entwerfen…**, **Ideen sammeln…**
- **Diese Seite** — **Diese Seite zusammenfassen**, **Aufgaben auf dieser Seite finden**
- **Workspace** — **Workspace fragen**: Claude liest die passendsten Seiten dieses Workspace und zitiert sie; nur diese Auszüge werden gesendet.
- **Mehr…** — **Neu machen mit Vorgaben…**, **An den Agenten übergeben…**, **Was Claude liest…**

## An einer Auswahl: KI fragen
Text markieren → **KI fragen** in der Werkzeugleiste (oder **KI fragen** im Blockmenü ⋮⋮ eines Textblocks). Innerhalb einer Zeile: **Text verbessern**, **Rechtschreibung & Grammatik**, **Kürzer machen**, **Übersetzen**, **Erklären**. Mehrere Blöcke: **Text verbessern**, **Rechtschreibung & Grammatik**, **Übersetzen**, **Verwandeln in …**, **Zusammenfassen**. **Mehr…** hat den Rest: **Länger machen**, **Aufgaben finden**, **Neu machen mit Vorgaben…**, **In Datenbank umwandeln**, **In Seite umwandeln**, **Ins Gedächtnis …**, **An den Agenten übergeben…**

Die Antwort erscheint fortlaufend. Dann **Auswahl ersetzen** (oder **Darunter einfügen**), **Überarbeiten** mit einer weiteren Anweisung, **Nochmal versuchen**, **Kopieren** oder **Verwerfen**. Bevor Claude eine Seite ändert, wird eine Version gesichert — siehe [Versionsverlauf](help:history).

## Was Claude liest
Unter der Eingabe sagt eine Zeile, was von dieser Seite an Claude geht: **Liest · ganze Seite · 1.204 Wörter**, **3 markierte Blöcke · 412 Wörter** oder **nichts von dieser Seite** — dazu **Auswahl** bei Aktionen auf markiertem Text (die Auswahl wird immer gelesen). Ein Klick auf die Zeile (oder *kontext* tippen) bietet **Ganze Seite**, **Nur markierte Blöcke**, **Blöcke markieren…** und **Nichts von dieser Seite**.

**Blöcke markieren…** setzt neben jeden Block ein Kästchen und pausiert das Tippen: Klick oder <kbd>Leertaste</kbd> markiert, <kbd>Shift</kbd>-Klick markiert einen Bereich, <kbd>j</kbd> / <kbd>k</kbd> (oder Pfeile) bewegen, <kbd>a</kbd> alle, <kbd>n</kbd> keine, <kbd>Enter</kbd> fertig, <kbd>Esc</kbd> bricht ab. Das Feld kommt mit deiner Bitte zurück. Markierte Blöcke gehen als Markdown raus (Links und Erwähnungen bleiben lesbar); nicht markierter Text wird nie gesendet. Gibt es nichts zu lesen, fragen **Weiterschreiben** und **Diese Seite zusammenfassen** erst nach, statt zu senden. Markierungen gehören zu diesem Tab: Sie folgen deinen Änderungen und werden nie gespeichert oder synchronisiert. Das [KI-Terminal](help:agent) hält sich auch daran.

## One-Gedächtnis
Eigene Anfragen nehmen das [One-Gedächtnis](help:memory) mit: **GEDÄCHTNIS · 3** unter *Liest* zeigt, welche Erinnerungen mitgehen — ein Klick zeigt die Liste, den **Verlauf** und einen Schalter für diese Anfrage. Beginnt eine Anfrage mit *merk dir …* (oder *remember …*), macht Claude daraus einen Vorschlag fürs Gedächtnis statt einer Antwort; an einer Auswahl tut **Ins Gedächtnis …** dasselbe, und **Als Beispiel merken …** behält die Blöcke als Beispiel. Nenne ein Beispiel — `#wochenbericht` — und Claude baut darauf auf.

## In Datenbank umwandeln
Markiere eine Liste, eine Tabelle oder einen Bericht aus mehreren Blöcken → **KI fragen** → **Mehr…** → **In Datenbank umwandeln** (oder *datenbank* tippen). Claude liest die Blöcke und schlägt eine Tabelle vor: die Einträge mit ihren Feldern (Status, Zuständige, Tags, Referenzcodes …), gruppiert nach den Überschriften, unter denen sie standen. Die Vorschau zeigt die Anzahl, die Spalten (was du nicht willst, schaltest du ab), **Gruppieren nach**, **Board** oder **Tabelle**, die ersten Einträge und was als Text bleibt — Einleitungen und Notizen behalten Formatierung und Links. **Umwandeln** (<kbd>Enter</kbd>) setzt die Datenbank an die Stelle der Liste; <kbd>Mod+Z</kbd> holt den Text in einem Schritt zurück (**Rückgängig** im Hinweis entfernt auch die Datenbank). Nichts wird erfunden: Was der Text nicht sagt, bleibt leer. **Platzierung**: **Hier (inline)** (Standard) oder **Als eigene Seite (verlinkt)** — eine ganzseitige Datenbank unter dieser Seite, verlinkt an der Stelle der Liste.

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
**KI fragen** → **Mehr…** → **In Seite umwandeln** verschiebt die markierten Blöcke sofort in eine neue Unterseite — ohne Claude — und lässt an ihrer Stelle einen Link. Dasselbe im Blockmenü ⋮⋮ (**Umwandeln in → Seite**) und mit <kbd>Mod+Alt+9</kbd>; siehe [Ziehen, umwandeln, färben](help:block-handle).

**Unterseite pro Eintrag** (ebenfalls unter **Strukturieren**, und **Verwandeln in → Seiten + Tabelle**) macht jeden Eintrag der Auswahl zu einer eigenen Unterseite — Listenpunkte, Abschnitte unter Überschriften oder Tabellenzeilen — und setzt eine Tabelle an ihre Stelle: ein Link auf jede Seite und bis zu drei Felder, die die Einträge gemeinsam haben (Zeilen wie *Status: offen*, das Häkchen einer Aufgabe, die Spalten der Tabelle). Ohne Claude, ein Schritt: **Rückgängig** im Hinweis oder <kbd>Mod+Z</kbd> holt die Einträge zurück.

## Getippte Wünsche, die Aktionen sind
Manche Wünsche sind eigentlich Aktionen — das KI-Menü führt sie aus, statt Text an Claude zu schicken. Die Taste steht oben, <kbd>Enter</kbd> führt sie aus:
- *„mach daraus eine Unterseite“*, *„auslagern“*, *„make a sub-page out of this“* → **In Seite umwandeln**;
- *„für jeden Punkt eine Unterseite“*, *„pro Ticket eine Seite“*, *„one page per item“* → **Unterseite pro Eintrag**;
- *„als Tabelle“*, *„als Board“* → **In Datenbank umwandeln**, mit deinen Worten als Anweisung;
- alles, was über die Auswahl hinausgeht — *„lege für jedes Ticket im Tracker eine Unterseite an“*, *„aktualisiere die Datenbank …“* → **Das braucht das KI-Terminal — dort ausführen**: Das [KI-Terminal](help:agent) öffnet sich mit deinem Wunsch und der Auswahl als Referenz und legt los.

Schreibwünsche (*kürzer*, *übersetzen*, *erklär …*) gehen wie bisher an Claude; **Claude fragen** bleibt für jeden Wunsch in der Liste.

## Neu machen mit Vorgaben
Markiere Stellen und lass Claude sie nach deinen Vorgaben neu machen: **KI fragen** → **Mehr…** → **Neu machen mit Vorgaben…** (auch im Blockmenü ⋮⋮ oder mit `/neu-machen` im KI-Terminal). Die Auswahl öffnet sich mit den markierten Blöcken — markiere weitere, auch weit auseinander (ganze Blöcke), dann <kbd>Enter</kbd>. Schreib, was anders werden soll — *kürzer, Du-Form, Fachbegriffe erklären* — und behalte es als Vorgabe-Chip fürs nächste Mal (bis zu 20, auf diesem Gerät; **⋯** benennt um oder löscht). Auf Wunsch kommt eine **Regeln-Seite** dazu (`@` im Feld): ein Styleguide oder Glossar, dessen Inhalt mitgeht. **Neu machen** (<kbd>Mod+Enter</kbd>) läuft wie jede Anfrage im Hintergrund; die Seite geht so mit, wie **Was Claude liest** es erlaubt.

Die Prüfung zeigt eine Stelle nach der anderen — entfernte Wörter durchgestrichen, neue unterstrichen: <kbd>y</kbd> oder <kbd>Enter</kbd> nimmt an, <kbd>n</kbd> lehnt ab, <kbd>j</kbd> / <kbd>k</kbd> bewegen, <kbd>a</kbd> nimmt alle an, <kbd>Esc</kbd> schließt (das Ergebnis wartet). Übernehmen schreibt alle angenommenen Stellen in einem Schritt — ein <kbd>Mod+Z</kbd> nimmt es zurück, vorher wird eine Version gesichert. Formatierung, Links und Erwähnungen bleiben. Eine Stelle, die du inzwischen geändert hast, wird übersprungen statt überschrieben; Bilder, Datenbanken, Einbettungen und andere Blöcke ohne Text ebenso.

## Claude für Bilder
Fahr über ein Bild (am Handy: tipp es an) und drück die Taste **KI** in seiner Leiste — oder öffne das Blockmenü ⋮⋮ (<kbd>Alt+Enter</kbd>) → **Claude**. **KI fragen** an einer Auswahl mit genau einem Bild zeigt sie ebenfalls:
- **Bild beschreiben** — Claude schlägt einen **Alternativtext** (ein kurzer Satz) und eine **Bildunterschrift** (eine Zeile) vor. Im Panel anpassen, dann **Alternativtext + Bildunterschrift übernehmen** — ein Schritt, ein <kbd>Mod+Z</kbd>.
- **Text auslesen** — alles, was im Bild steht, als Markdown (Überschriften, Listen und Tabellen bleiben, der Text wie geschrieben, nicht übersetzt) → **Unter dem Bild einfügen**.
- **Bild → Tabelle** — jede Tabelle im Bild (eine Volumentabelle, ein Zeitplan, ein Platten-Layout …) mit Kopfzeile → **Als Tabelle einfügen** (ein Block pro Tabelle), **Als Tabellenkalkulation einfügen** (ein Blatt pro Tabelle, Zahlen als Zahlen) oder, bei genau einer Tabelle, **Als Datenbank …** (die Vorschau von [In Datenbank umwandeln](help:ai-menu), dann **Datenbank unter dem Bild anlegen**).
- **Frage zum Bild …** — eine beliebige Frage tippen; die Antwort läuft ein → **Unter dem Bild einfügen** oder **Kopieren**.

Das Bild geht nur mit diesen Aktionen an Anthropic, verkleinert auf höchstens 1568 px und 5 MB (ein GIF als erstes Bild, ein SVG als Pixel); die Seite geht mit, soweit **Was Claude liest** es erlaubt. Sie laufen im Hintergrund wie jede Anfrage. Ein Webbild, dessen Website One das Lesen nicht erlaubt (CORS), lässt sich nicht senden — das Panel sagt es und bietet **Kopie hochladen …** an. Im [KI-Terminal](help:agent) fügt <kbd>Mod+Shift+J</kbd> auf einem ausgewählten Bild es als Chip hinzu (**▣ … · Bild 1,2 MB**); die nächste Aufgabe schickt das Bild mit.

## Claude für Dateien
Jeder Datei-Block hat eine Taste **KI** in seiner Leiste (auch ein PDF im Viewer) und eine Gruppe **Claude** im Blockmenü ⋮⋮ — Uploads, [Mail-Anhänge](help:gmail-sync) und Dateien aus dem Web gleichermaßen. Was sie anbietet, hängt von der Datei ab:
- **PDF** — **Zusammenfassen** (was es ist, die wichtigsten Punkte, eine *Zu tun*-Zeile → **Unter der Datei einfügen**), **Text als Seite auslesen** (das Dokument als bearbeitbare Unterseite, Überschriften bleiben), **Tabellen auslesen** (→ Tabelle, Tabellenkalkulation oder Datenbank, wie die Tabellen eines Bilds), **Frage zur Datei …**.
- **Word (.docx), HTML, Markdown, RTF, Text** — **Als Seite öffnen**: direkt hier umgewandelt, nichts wird gesendet — Überschriften, Listen, Tabellen, fett / kursiv und Links bleiben (Bilder einer Word-Datei nicht). Titel und Gliederung prüfen, dann **Seite anlegen** (eine Unterseite, unter der Datei verlinkt) oder **Unter der Datei einfügen**. **Zusammenfassen** und **Frage** schicken den umgewandelten Text.
- **CSV, TSV, Excel (.xlsx)** — **Als Datenbank importieren …** (Spaltentypen wie beim Import: Zahlen, Daten, Checkboxen, Auswahlen; vorher die Vorschau von [In Datenbank umwandeln](help:ai-menu); bei einer Arbeitsmappe die Blätter zur Wahl) oder **Als Tabellenkalkulation öffnen** (alle sichtbaren Blätter), ebenfalls hier umgewandelt. **Claude zu den Daten fragen …** schickt die Tabelle als CSV.

Mit **LOKAL** markierte Einträge verlassen das Gerät nie. Die Datei geht nur mit den Claude-Aktionen an Anthropic — ein PDF als Dokument von höchstens etwa 23 MB und 600 Seiten (100 mit Claude Haiku 4.5), andere Dateien als ihr Text (höchstens 400.000 Zeichen; das Panel sagt, wenn gekürzt wurde). Eine zu große Datei wird abgelehnt, bevor etwas gesendet wird — mit den Zahlen. Ein HTML-Anhang wird eine Seite ohne Skripte, Formulare oder Zählpixel — Bilder aus dem Web werden zu Links. Alles läuft im Hintergrund wie jede Anfrage, vorher wird eine Version gesichert, und <kbd>Mod+Z</kbd> (oder **Rückgängig** im Hinweis bei einer neuen Seite oder Datenbank) nimmt es zurück. Im [KI-Terminal](help:agent) fügt <kbd>Mod+Shift+J</kbd> auf einem ausgewählten Datei-Block ihn als Chip hinzu (**▤ … · PDF 1,2 MB**); die nächste Aufgabe schickt die Datei mit.

## Läuft im Hintergrund weiter
Eine Anfrage läuft weiter, wenn du das Feld schließt, in die Seitenleiste klickst oder eine andere Seite öffnest — nur **Stopp** und **Verwerfen** beenden sie. Die Seite zeigt sie unten an (**KI · Schreibt…**, dann **KI-Ergebnis fertig · Ansehen**), die Seitenleiste markiert die Seite mit einem Punkt, und ein Hinweis mit **Öffnen** meldet ein fertiges Ergebnis auf einer anderen Seite. Hat sich der Text inzwischen geändert, findet One ihn wieder; ist er weg, ist **Auswahl ersetzen** aus und **Darunter einfügen** setzt ans Ende der Seite. Ergebnisse warten auf diesem Gerät (auch nach dem Neuladen), bis du sie übernimmst oder verwirfst — höchstens 7 Tage, nie synchronisiert.

## ⌘K, dann ?
Tippe `?` in der Befehlspalette, um Claude zur geöffneten Seite zu fragen. Die Antwort an die Seite anhängen, als neue Seite anlegen oder kopieren.

> Anfragen gehen aus deinem Browser mit deinem Schlüssel an Anthropic. Hinzugefügte MCP-Server können bei freien Anfragen mitmachen — siehe [MCP-Server](help:mcp-servers).
