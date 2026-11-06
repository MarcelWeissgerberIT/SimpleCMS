---
id: outbox
title: Ausgang
section: ai
order: 15
keywords: Ausgang, Zettel, senden, Sendeweg, Sendewege, Entwurf, von Hand, kopieren und öffnen, als gesendet markieren, Quittung, Zeile zurücksetzen, geändert, fremd, FREMD, zurückhalten, neu entwerfen, trotzdem senden, zurückziehen, OUT, Sperre, Ticket, antworten, Arbeit buchen, outbox, slip, send route, receipt
related: integrations, custom-agents, mcp-servers, database-commands
summary: Claude entwirft eine Antwort oder Änderung für ein anderes Werkzeug, du siehst genau, was rausginge, und sendest selbst — Zettel, FREMD-Marken, GEÄNDERT laut Spiegel, Quittungen.
---
In ein anderes Werkzeug schreiben — ein Kommentar im Ticket, ein Status, gebuchte Zeit — ist die Stelle, an der ein Fehler am meisten kostet. Der Ausgang teilt das in drei Schritte, und nur der letzte gehört allein dir:

1. **Claude entwirft.** Befehle auf einer gespiegelten Zeile → **Im Ticket-Tool antworten**. Claude schreibt den Text in einer Anfrage **ganz ohne Werkzeuge** — es kann nichts senden, was auch immer in der Zeile steht.
2. **Du schaust.** Aus dem Entwurf wird ein **Zettel**: der Text genau so, wie er rausgeht, die Eingaben des Werkzeugs, was sich danach in One ändert, was Claude gelesen hat — jedes Stück Text von anderen ist **FREMD** markiert.
3. **Du sendest.** **Kopieren & öffnen**, im anderen Werkzeug posten, **Als gesendet markieren**. One aktualisiert die Zeile und behält eine Quittung.

Nichts in One sendet von selbst: nicht das KI-Menü, nicht ⌘K, nicht das [KI-Terminal](help:agent), kein Agent — auch nicht mit „Direkt anwenden“.

## Sendewege
Ein Sendeweg gehört zu einem [Integrationsprofil](help:integrations) (`sends`). Er nennt das Werkzeug, das schreibt, seine Eingaben als Vorlage und wie die Zeile danach aussieht:

```json
"sends": [{
  "id": "reply", "role": "reply",
  "label": { "en": "Reply in the ticket tool", "de": "Im Ticket-Tool antworten" },
  "tool": "add_comment",
  "args": { "ref": "{key}", "visibility": "team", "body": "{draft}" },
  "params": [{ "name": "draft", "type": "text", "max": 4000, "style": "Kurz, freundlich, du-Form" }],
  "after": [{ "property": "waiting", "value": false }],
  "via": ["hand"]
}]
```

- `{key}` ist die Schlüssel-Eigenschaft der Zeile; er darf in einem Text stehen (`"LDG-{key}"`), `"{key|number}"` macht eine Zahl daraus.
- `{draft}` ist der Text, den Claude (oder du) schreibt; jeder Parameter füllt einen **ganzen** Wert — die Eingaben werden als Werte gebaut, nie als zusammengeklebter Text. `{sentAt}` ist der Zeitpunkt deines Drucks.
- `params` vom Typ `option` (eine Liste `values`), `minutes` (`max`, `round`) oder `number` ergeben Sendewege **ohne** Text — Status weiterschieben, Zeit buchen. Sie fragen Claude nie.
- `after` setzt Eigenschaften der Zeile (per Rolle oder Name), sobald der Zettel gesendet ist.
- `check`, `confirm` und `reads` beschreiben, wie sich das Ergebnis zurücklesen lässt; das Senden von Hand nutzt sie noch nicht.

Das Profil braucht die Freischaltungen `sends` und `keys` und muss seinen Server **über Name oder Host** finden. Jedes `sends[].tool` ist dann **OUT**: in jeder Claude-Anfrage, die One für diesen Server stellt, abgeschaltet — egal, was Werkzeuglisten, Codewörter oder gewählte Werkzeuge sagen. **Einstellungen → Claude KI → MCP-Server** zeigt pro Server, wie viele OUT sind.

## Einen Zettel entwerfen
Ein Sendeweg erscheint als [Datenbank-Befehl](help:database-commands) der gespiegelten Datenbank: die Befehle-Taste an ihrer Zeile in der Seitenleiste, das Rechtsklick-Menü, die Befehle-Taste der Werkzeugleiste (erst eine Zeile wählen) und ⌘K „<Datenbank>: Im Ticket-Tool antworten“. Die Tafel **Sendewege** unter der Tabelle listet sie auch.

Das Popover nimmt eine Anweisung (optional) — `@` oder `one:` erwähnt deine eigenen Seiten — und bietet **Claude entwirft** (↵) oder **Selbst schreiben**. Claude liest die Zeile (als Text von anderen), die Seiten, die du erwähnst (nur, was ihre Kontext-Marken durchlassen), dein [Gedächtnis](help:memory) und deine Anweisung; die Kostenzeile zeigt, was es gekostet hat. Mit mehreren gewählten Zeilen bekommt jede ihren eigenen Zettel (bis zu 10). Das Popover zu schließen hält keinen Entwurf an.

## Einen Zettel lesen
- **Der Text** steht roh da — keine Formatierung, keine Bilder, Link-Ziele voll ausgeschrieben. Versteckte Zeichen erscheinen als `⟦U+202E⟧` und lassen **VERSTECKTE ZEICHEN** leuchten. Nichts geht raus, bevor sein ganzer Text im Zettel zu sehen war: ein kurzer, sobald er dasteht, ein langer nach **Ganzen Text zeigen** (eine Karte in #/outbox zeigt nur den Anfang). **E** bearbeitet ihn; danach werden Claudes Entwurf und dein Text Wort für Wort verglichen.
- **EINGABEN** sind die Argumente des Werkzeugs genau so, wie sie benutzt werden. **DANACH** listet die Änderungen an der Zeile und die Notiz im Posteingang, die archiviert wird. **GELESEN** listet die Quellen.
- **FREMD** markiert Text, den du nicht selbst geschrieben hast: die Felder des Spiegels (auch die Optionen, die er aus der Quelle angelegt hat — ein Status, ein Schlagwort), Kommentare, Mails, Seiten, die ein Agent, Claude, ein Import oder die geteilte Seite von jemand anderem geschrieben hat. Eine Adresse im Entwurf — ein Link jeder Art, ein Host, eine IP-Adresse, eine Mail-Adresse —, die nur in fremdem Text oder in gar keiner Quelle steht, wird im Text markiert und braucht ihr Häkchen, bevor der Zettel rausgehen kann. Eine Adresse, die du in die Anweisung getippt oder selbst neu in den Text geschrieben hast, ist deine; ein Punkt oder Schrägstrich neben einer markierten ändert nichts.
- Die Meldelampen: **FREMDTEXT**, **GEÄNDERT**, **GESENDET**, **BESTÄTIGT**; **VERSTECKTE ZEICHEN** und **UNKLAR** nur, wenn sie leuchten. Ein von Hand gesendeter Zettel ist nie BESTÄTIGT — niemand hat ihn zurückgelesen.

## GEÄNDERT laut Spiegel
Beim Entwurf merkt sich der Zettel die Quellfelder der Zeile — Zahl der Kommentare, Zeit des letzten Kommentars, Status der Quelle. Ändert der nächste Spiegel-Lauf sie, leuchtet **GEÄNDERT** und ein Band zitiert den neuesten Kommentar: „Kommentare 7 → 8 · Status (Quelle) unverändert — Letzter Kommentar heute 08:09 „Hat sich erledigt, B7 passt.““. Auch ein Kommentar, der eintrifft, während Claude noch entwirft, zählt. **H** hält den Zettel zurück, **R** entwirft neu aus der Zeile, wie sie jetzt ist, **Trotzdem senden** sagt, dass du es gelesen hast. Die Zeile **LAUT SPIEGEL 07:30** ist ehrlich, woher das kommt: wann der Spiegel zuletzt auf diesem Gerät lief („Lauf hier nicht gesehen“, wenn er woanders lief), und **GELESEN 07:48**, wann der Zettel die Zeile gelesen hat. One vergleicht, was der Spiegel geschrieben hat; es fragt das andere Werkzeug nicht selbst. Der Kommentar, den du selbst gesendet hast, zählt nicht als Änderung.

## Von Hand senden
**Kopieren & öffnen** (⌘↵) kopiert den Text und öffnet den Link der Zeile — **ÖFFNET** zeigt, wohin; ein Link, der von der Adresse des Servers wegführt, ist FREMD markiert und braucht ein eigenes Häkchen. Die übrigen Eingaben stehen unter „Dort auch setzen“. Poste ihn dort und beantworte **In tracker gesendet?** mit **Ja, als gesendet markieren** — oder **Noch nicht**. Änderst du den Text dazwischen, verschwindet die Frage: dann erneut kopieren. Als gesendet markieren:
- schreibt die `after`-Werte des Sendewegs als **eine** Version in die Zeile („Ausgang · Im Ticket-Tool antworten“ in ihrem [Verlauf](help:history)); ein Feld, das du seit dem Zettel geändert hast, bleibt, wie es ist;
- archiviert die Notiz des Spiegel-Agenten zu dieser Zeile im Posteingang;
- behält eine Quittung **VON HAND · nicht geprüft**.

**Zeile zurücksetzen** auf der Quittung stellt die Zeile zurück — nur Felder, in denen noch steht, was der Ausgang geschrieben hat; was rausging, bleibt draußen. Einen gesendeten Zettel kannst du nicht mehr zurückziehen.

## Wo die Zettel sind
- **Das Dock** neben der Datenbank: eine Spalte ab 1200 px, darunter ein Blatt, auf dem Handy bildschirmfüllend mit **Zurückhalten** und **Kopieren & öffnen** unten. Tasten: **J** / **K** nächster / vorheriger Zettel, **H** zurückhalten, **E** bearbeiten, **R** neu entwerfen, **⌘↵** kopieren & öffnen, **Esc** zurück.
- **#/outbox**: Zähler (gehen raus, Fremdtext, zurückgehalten), Reiter, die sauberen Zettel und die einzeln zu prüfenden (jeder mit Grund), die Quittungen von heute und jeder Sendeweg. Tasten wirken auf die Karte, auf der du bist; **⌘↵** öffnet dort ihren Zettel im Dock.
- Die Zeile **Ausgang** in der Seitenleiste, eine Zahl an der Zeile der Datenbank, **IM AUSGANG** / **GESENDET HEUTE** auf der Datenbankseite und die Statusleiste — überall dieselben Zahlen.

## Was auf diesem Gerät bleibt
Zettel und Quittungen liegen in diesem Browser, pro Workspace (im Team-Workspace: pro Mitglied) — geteilt zwischen seinen Tabs, nie synchronisiert, exportiert oder an Claude geschickt, und entfernt mit der Kopie des Workspace. Bis zu 500 offene Zettel pro Workspace; zurückgezogene bleiben 30 Tage, gesendete ein Jahr. Verweigert der Browser den Speicher, wird nichts angelegt, und das Dock sagt warum.
