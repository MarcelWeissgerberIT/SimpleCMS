---
id: mcp-servers
title: MCP-Server (Wissensdatenbanken & Co.)
section: ai
order: 6
keywords: mcp, mcp-server, werkzeuge, connector, wissensdatenbank, token, externe werkzeuge, integration, codewort, kb:, oauth, anmelden, anmeldecode, code, bild, video, generieren, medien, in one speichern, tools, knowledge base, codeword, sign in, generate image
related: agent, ai-menu, mcp-token-rejected, mcp-bridge, claude-key
summary: Lass Ones Claude die Werkzeuge anderer Systeme nutzen — eine Wissensdatenbank, einen Tracker, ein CRM.
---
**Einstellungen → Claude KI → MCP-Server.** Dafür brauchst du zuerst [deinen Claude-Schlüssel](help:claude-key).

## Server hinzufügen (Beispiel Wissensdatenbank)
1. In deiner Wissensdatenbank die MCP-Server-Adresse kopieren (`https://…/mcp`) und ein Token für One erstellen — nur lesend und auf die nötigen Projekte beschränkt, wenn sie das anbietet.
2. In One: **Server hinzufügen**, **Server-URL** und **Token** einfügen, **Speichern**.
3. One benennt den Server nach seiner Adresse, schaltet ihn ein und prüft ihn im Hintergrund: Verbindungstest, Liste der Werkzeuge, die Claude sieht, und ein **Nutzungs-Prompt**, der Claude sagt, welches Werkzeug wofür da ist. Die LED springt auf **Verbunden**.

## Wo er genutzt wird
**Erweitert** → **Verwendet bei**:
- **Agent, eigene Anfragen und ⌘K-Fragen** (Standard) — der Agent, deine eigenen Anfragen im KI-Menü und `?` in ⌘K.
- **Alle KI-Aufrufe** — auch die Ein-Klick-Aktionen, KI-Autofill und Besprechungszusammenfassungen. Jede dieser Anfragen wird länger und langsamer.

Unter **Erweitert** stehen außerdem Name, Codewort (unten), Token, Nutzungs-Prompt (**Erzeugen** / **Neu erzeugen**, oder selbst schreiben), **Verbindung testen** und **Server entfernen**. Während Claude arbeitet, erscheinen MCP-Aufrufe als kleine Chips, z. B. `KB · search`.

Ein Server, der sein Token ablehnt (abgelaufen oder noch nicht angemeldet), hält deine Anfragen nicht mehr auf: Claude antwortet ohne ihn, und ein Hinweis sagt *„… hat sein Token abgelehnt — Claude antwortet ohne ihn“*. In diesem Tab bleibt er draußen, bis du dich neu anmeldest oder das Token ersetzt — oder du sprichst ihn mit seinem Codewort an, dann siehst du den Fehler.

## Codewort
**Erweitert** → **Codewort**: ein kurzes Wort wie `kb` — One schlägt den Namen des Servers vor, **verwenden** übernimmt ihn. Beginne eine Anfrage damit — *„kb: Was wissen wir über den Launch?“* — im KI-Menü, bei `⌘K ?` oder im Agenten, und Claude antwortet zuerst mit den Werkzeugen dieses Servers (das `kb:` selbst wird nicht mitgeschickt). Mehrere gehen auch: `kb: wiki: …`. Im KI-Terminal zeigt `kb:` die Werkzeuge des Servers (aus **Verbindung testen**): eines mit <kbd>Tab</kbd> wählen, und Claude soll genau das nutzen.
- Beim Tippen zeigt ein Chip den Server: `→ KB`. Ein ausgeschalteter Server bleibt aus — die Antwort sagt das.
- a–z, 0–9, `-` und `_`, bis 24 Zeichen, eines je Server. `one` ist reserviert: Das ist Ones eigenes Codewort in Claude Desktop ([Claude Desktop & lokales MCP](help:mcp-bridge)).

## Anmelden statt Token
Manche Server haben eine eigene Anmeldeseite (OAuth) statt eines Tokens zum Einfügen. Lehnt ein Server den Verbindungstest ab, sagt seine Zeile das und bietet **Anmelden** an; du findest es auch unter **Erweitert** → **Anmeldung**.
1. **Anmelden** öffnet ein kleines Fenster mit der Anmeldeseite des Servers (One registriert sich dort selbst, wenn der Server das erlaubt).
2. Anmelden und Zugriff erlauben — das Fenster schließt sich, die Zeile zeigt **Angemeldet**, und die Verbindung wird erneut getestet.
3. **Abmelden** entfernt die Tokens aus diesem Browser.

One erneuert das Zugriffstoken kurz bevor es abläuft. Blockiert der Browser das Fenster, geht der Tab zur Anmeldeseite und kommt zurück. Nennt ein Server mehrere Anmeldedienste, nimmt One den ersten, mit dem ein Browser sprechen kann, und registriert sich dort.

### Mit Code anmelden
Manche Anmeldungen schicken das Fenster nicht zu One zurück — sie zeigen dort einen Fehler oder lehnen One als Rückweg ab. Dann meldest du dich mit einem Code an: Während das Fenster wartet, **Stattdessen mit Code** (oder **Mit Code anmelden**, sobald One weiß, dass der Server das anbietet). Die Einstellungen zeigen einen kurzen Code wie `WDJB-MJHT`; das Fenster geht zur Seite des Servers dafür — dort den Code eingeben und den Zugriff erlauben. One wartet und macht von selbst weiter; **Abbrechen** beendet es.

Lässt sich eine Anmeldung im Browser gar nicht abschließen (die Anmeldung des Servers lässt keine Browser zu, CORS), steht das da — dann fügst du wie bisher ein Token ein.

### Aus dem KI-Terminal verbinden
Im [KI-Terminal](help:agent) listet `/verbinden` die Server und wie sie stehen (angemeldet, Token, Anmeldung nötig, aus). `/verbinden kb` — ein Name, ein Codewort oder eine Adresse — meldet an: Das Fenster öffnet sich direkt mit deinem <kbd>Enter</kbd>, und das Terminal zeigt das Warten, den Code (mit **Stattdessen mit Code**), den Verbindungstest und **Verbunden · 3 Werkzeuge**. Ein Server, dessen Token funktioniert, wird nur getestet; kein Fenster öffnet sich. `/verbinden https://…` fügt zuerst einen Server per Adresse hinzu. Blockiert der Browser das Fenster, sagt das Terminal es und bleibt, wo es ist — erlaube Pop-ups für One oder drück **Neu anmelden**. Ein Server, den du während eines Gesprächs hinzufügst, ist nach `/neu` dabei; einer, bei dem du dich neu anmeldest, wird sofort mit der neuen Anmeldung genutzt.

## Medien in One speichern
Bild- und Videodienste (und andere) liefern Bilder, Clips oder Audio. One zeigt jedes als **Karte** — Dateityp, Host, Größe, wenn bekannt — unter der Antwort im KI-Menü, bei `⌘K ?`, im [KI-Terminal](help:agent) und in den Läufen [eigener Agenten](help:custom-agents). Geladen wird erst, wenn du klickst.
- **In One speichern** (oder **Alle speichern**) holt die Datei in diesem Browser, prüft, ob sie wirklich ein Bild, Video oder Audio ist (Typ und Inhalt), speichert sie in diesem Browser und setzt den Block dorthin, wo du gefragt hast: unter die Auswahl im KI-Menü, ans Ende der aktuellen Seite bei `⌘K ?`. Im Terminal legt das Speichern **Medien einfügen** zur Prüfung vor — auf der Seite, an der die Aufgabe gearbeitet hat, oder auf einer neuen Seite „Generierte Medien“.
- Ein Host, der Browser seine Dateien nicht laden lässt: Die Karte bietet **Öffnen** (neuer Tab) und **Kopie hochladen**. In einem Team-Arbeitsbereich holt **Über den Team-Server holen** die Datei dort (nur https, nie private Adressen).
- SVG-Dateien werden nur zum Herunterladen gespeichert — sie können Skripte enthalten.

## Bilder und Videos generieren
Tippe `/bild generieren` (oder `/video generieren`) in eine Zeile, oder klicke **Generieren…** in einem leeren Bildblock.
1. Wähle den **Dienst** — Server, deren Werkzeuge Bilder (oder Videos) erzeugen. One merkt sich die Wahl auf diesem Gerät.
2. Schreib den **Prompt**, wähle Seitenverhältnis und Anzahl der Ergebnisse, und hake **Diese Seite als Kontext mitgeben** nur an, wenn die Seite mitgehen soll. Aus deinem One-Gedächtnis geht nichts mit.
3. **Generieren**. Claude ruft nur diesen Server auf und wartet auf den Auftrag. Das Schließen des Panels hält ihn nicht an — die Seite zeigt, wenn die Ergebnisse da sind.
4. **Ansehen** zeigt ein Ergebnis vorab (erst dann wird es geladen, gespeichert wird es nicht). Wähle ein oder mehrere Ergebnisse und **Auswahl einfügen** — sie werden in One gespeichert, kommen in die Seite und das Fenster schließt sich.

> Das Generieren kann Guthaben bei diesem Dienst verbrauchen.

## Wie es funktioniert — und das Token
Anfragen gehen an `api.anthropic.com`; Anthropic verbindet sich mit dem Server, während Claude antwortet. Deshalb gehen nur entfernte Server, die per HTTPS erreichbar sind (Streamable HTTP oder SSE) — keine lokalen.

> Das Token geht mit jeder Anfrage, die den Server nutzt, an Anthropic und liegt versiegelt in diesem Browser — nie in Backups, Exporten oder Sync (auch die Tokens einer Anmeldung nicht). Nimm ein eigenes Token für One, möglichst nur lesend. Auf einem anderen Gerät trägst du das Token erneut ein oder meldest dich dort an.
