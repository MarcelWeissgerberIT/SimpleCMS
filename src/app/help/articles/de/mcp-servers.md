---
id: mcp-servers
title: MCP-Server (Wissensdatenbanken & Co.)
section: ai
order: 6
keywords: mcp, mcp-server, mcp verbindungen, verbindungen, was verbunden ist, übersichtsseite, übersicht, tabelle, freigabe, werkzeuge, connector, wissensdatenbank, token, externe werkzeuge, integration, codewort, kb:, oauth, anmelden, anmeldecode, code, bild, video, generieren, medien, in one speichern, tools, knowledge base, codeword, sign in, generate image, connections, overview page
related: agent, ai-menu, mcp-token-rejected, mcp-bridge, claude-key
summary: Nutze externe Werkzeuge mit Claude, Copilot oder werkzeugfähigem Atlas Flow — mit persönlichem Zugang und nachvollziehbaren Aufrufen.
---
**Einstellungen → KI → MCP-Server.** Wähle ein verfügbares, werkzeugfähiges Modell. Für Claude brauchst du [deinen Claude-Schlüssel](help:claude-key), für Copilot deinen angemeldeten Worker. Das vorbereitete Atlas Flow in den AJ-Workspaces nutzt deinen persönlichen Atlas-Zugang über den ONE-Cloud-Proxy. Dafür ist kein Claude-Schlüssel nötig.

## Server hinzufügen (Beispiel Wissensdatenbank)
1. In deiner Wissensdatenbank die MCP-Server-Adresse kopieren (`https://…/mcp`) und ein Token für One erstellen — nur lesend und auf die nötigen Projekte beschränkt, wenn sie das anbietet.
2. In One: **Server hinzufügen**, **Server-URL** und **Token** einfügen, **Speichern**.
3. One benennt den Server nach seiner Adresse und schaltet ihn ein. **Verbindung testen** prüft den Zugang und die verfügbaren Werkzeuge. Mit einem verbundenen Worker oder dem vorbereiteten AJ-Atlas-Cloudzugang geschieht das direkt, ohne KI-Modell. Eine **Nutzungsanweisung generieren** ist eine separate KI-Aktion.

## Übersicht: wo welcher Server genutzt werden darf
Der Abschnitt beginnt mit einer Tabelle, eine Zeile pro Server: sein **Codewort**, **Claude in One** (welche Anfragen ihn nutzen, oder *Aus*), die **eigenen Agenten**, die ihn nutzen (mit der Zahl der Werkzeuge, die eine Werkzeugliste erlaubt; ein ausgeschalteter Agent durchgestrichen), die **Integrationen**, die er aktiv macht, und **Claude Code (Worker)** – die Repositories (und *Aufgaben ohne Repository*), in denen Claude Code im Coding-Worker einen Server gleichen Namens oder Codeworts hat. Die Server von Claude Code sind seine eigenen (dein `claude mcp`-Setup, pro Repository auf der Einrichtungsseite des Workers angehakt): Ein Name, den nur Claude Code hat, bekommt eine eigene Zeile. Ein Klick auf den Namen öffnet die Details des Servers.

## Alle Verbindungen auf einen Blick
⌘K **MCP · Verbindungen** (`#/mcp`) zeigt jede MCP-Verbindung, die One kennt, auf einer Seite — **Alle Verbindungen →** hier und unter **Einstellungen → Agenten · MCP** öffnet sie auch:
- **§ 01 Claude in One** — diese Server, jeder mit Lampe und Wort: **OK** (wann getestet, wie viele Werkzeuge), **Nicht getestet**, **Test fehlgeschlagen** (gelb), **Token abgelehnt** oder **Anmeldung abgelaufen** (rot), **Aus**. Die Lampen folgen der Token-Lampe im [Vorflug-Check](help:preflight): Dort sind dieselben Server rot oder gelb. Jede Zeile bietet **Testen** (direkt über Worker oder AJ-Atlas-Cloudzugang; sonst über das gewählte Modell — nur auf deinen Druck), **Anmelden** in einer roten Zeile und **Einstellungen ↗** zu seiner Karte hier.
- **§ 02 Claude Desktop · Code** — die Brücke dieses Tabs ([Claude Desktop & lokales MCP](help:mcp-bridge)): verbunden oder nicht, welcher Client, was Agenten ändern dürfen.
- **§ 03 Coding-Worker** — die Verbindung dieses Browsers zum Worker und die MCP-Server, die Claude Code dort hat, pro Repository.
- **§ 04 Team-Server** — in einem Team-Workspace: die `/mcp`-Adresse des Workspace und die MCP-Server der Server-Agenten.

Die Seite sendet beim Öffnen nichts und öffnet kein Token: Sie zeigt, was One zuletzt sah — den letzten Test, Ablehnungen in diesem Tab, wann eine Anmeldung abläuft. Jeder Abschnitt sagt, wo seine Einstellung liegt (dieses Gerät, dieser Tab, dieser Browser, der Team-Server). **Dieser Browser hat keine Kopie des Tokens** steht nur hier in den Einstellungen, auf der Karte des Servers — die Seite öffnet die versiegelten Tokens nie. Anfragen lassen den Server dann wortlos weg; nur eine Anfrage, die ihn mit seinem Codewort anspricht, sagt es.

## Wo er genutzt wird
**Erweitert** → **Verwendet bei**:
- **Agent, eigene Anfragen und ⌘K-Fragen** (Standard) — der Agent, deine eigenen Anfragen im KI-Menü und `?` in ⌘K.
- **Alle KI-Aufrufe** — auch die Ein-Klick-Aktionen, KI-Autofill und Besprechungszusammenfassungen. Jede dieser Anfragen wird länger und langsamer.

Einen ausgeschalteten Server nutzt One auf diesem Gerät nicht — auch eigene Agenten, die ihn angekreuzt haben, lassen ihn in ihren Läufen weg, und ihr Editor sagt es.

Unter **Erweitert** stehen außerdem Name, Codewort (unten), Token, Nutzungs-Prompt (**Erzeugen** / **Neu erzeugen**, oder selbst schreiben), **Verbindung testen** und **Server entfernen**. Während Claude arbeitet, erscheinen MCP-Aufrufe als kleine Chips, z. B. `KB · search`.

Ein Server, der sein Token ablehnt (abgelaufen oder noch nicht angemeldet), hält deine Anfragen nicht mehr auf: Claude antwortet ohne ihn, und ein Hinweis sagt *„… hat sein Token abgelehnt — Claude antwortet ohne ihn“*. In diesem Tab bleibt er draußen, bis du dich neu anmeldest, das Token ersetzt oder ein Test gelingt — oder du sprichst ihn mit seinem Codewort an, dann siehst du den Fehler.

## Codewort
**Erweitert** → **Codewort**: ein kurzes Wort wie `kb` — One schlägt den Namen des Servers vor, **verwenden** übernimmt ihn. Beginne eine Anfrage damit — *„kb: Was wissen wir über den Launch?“* — im KI-Menü, bei <kbd>Mod+K</kbd> `?` oder im Agenten, und Claude antwortet zuerst mit den Werkzeugen dieses Servers (das `kb:` selbst wird nicht mitgeschickt). Mehrere gehen auch: `kb: wiki: …`. Im KI-Terminal zeigt `kb:` die Werkzeuge des Servers (aus **Verbindung testen**): eines mit <kbd>Tab</kbd> wählen, und Claude soll genau das nutzen.
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
Bild- und Videodienste (und andere) liefern Bilder, Clips oder Audio. One zeigt jedes als **Karte** — Dateityp, Host, Größe, wenn bekannt — unter der Antwort im KI-Menü, bei <kbd>Mod+K</kbd> `?`, im [KI-Terminal](help:agent) und in den Läufen [eigener Agenten](help:custom-agents). Geladen wird erst, wenn du klickst.
- **In One speichern** (oder **Alle speichern**) holt die Datei in diesem Browser, prüft, ob sie wirklich ein Bild, Video oder Audio ist (Typ und Inhalt), speichert sie in diesem Browser und setzt den Block dorthin, wo du gefragt hast: unter die Auswahl im KI-Menü, ans Ende der aktuellen Seite bei <kbd>Mod+K</kbd> `?`. Im Terminal legt das Speichern **Medien einfügen** zur Prüfung vor — auf der Seite, an der die Aufgabe gearbeitet hat, oder auf einer neuen Seite „Generierte Medien“.
- Ein Host, der Browser seine Dateien nicht laden lässt: Die Karte bietet **Öffnen** (neuer Tab) und **Kopie hochladen**. In einem Team-Arbeitsbereich holt **Über den Team-Server holen** die Datei dort (nur https, nie private Adressen).
- SVG-Dateien werden nur zum Herunterladen gespeichert — sie können Skripte enthalten.

## Bilder und Videos generieren
Tippe `/bild generieren` (oder `/video generieren`) in eine Zeile, oder klicke **Generieren…** in einem leeren Bildblock.
1. Wähle den **Dienst** — Server, deren Werkzeuge Bilder (oder Videos) erzeugen. One merkt sich die Wahl auf diesem Gerät.
2. Schreib den **Prompt**, wähle Seitenverhältnis und Anzahl der Ergebnisse, und hake **Diese Seite als Kontext mitgeben** nur an, wenn die Seite mitgehen soll. Aus deinem One-Gedächtnis geht nichts mit.
3. **Generieren**. Claude ruft nur diesen Server auf und wartet auf den Auftrag. Das Schließen des Panels hält ihn nicht an — die Seite zeigt, wenn die Ergebnisse da sind.
4. **Ansehen** zeigt ein Ergebnis vorab (erst dann wird es geladen, gespeichert wird es nicht). Wähle ein oder mehrere Ergebnisse und **Auswahl einfügen** — sie werden in One gespeichert, kommen in die Seite und das Fenster schließt sich.

> Das Generieren kann Guthaben bei diesem Dienst verbrauchen.

## Wie Claude sich verbindet — und das Token
Anfragen gehen an `api.anthropic.com`; Anthropic verbindet sich mit dem Server, während Claude antwortet. Deshalb gehen nur entfernte Server, die per HTTPS erreichbar sind (Streamable HTTP oder SSE) — keine lokalen.

> Das Token geht mit jeder Anfrage, die den Server nutzt, an Anthropic und liegt versiegelt in diesem Browser — nie in Backups, Exporten oder Sync (auch die Tokens einer Anmeldung nicht). Nimm ein eigenes Token für One, möglichst nur lesend. Auf einem anderen Gerät trägst du das Token erneut ein oder meldest dich dort an.

## Persönliche Tokens für Claude Code

Unter [Meine Secrets](help:personal-secrets) speicherst du Atlas- und Agenten-Tokens pro Person mit eigener Passphrase. In einer Coding-Aufgabe gibst du die benötigten Verbindungen ausdrücklich für den aktuellen Worker frei. Diese Freigabe ist getrennt von den normalen MCP-Verbindungen für Browser-Agenten; bestehende Verbindungen werden nicht automatisch migriert.


## Modell und Freigabe für Nutzungsanweisungen
Öffne beim Server **Erweitert**. Für KI-generierte Nutzungsanweisungen und Verbindungstests ohne direkten Datenweg lässt sich ein verfügbares MCP-fähiges Modell wählen; diese Wahl wird auf deinem Gerät gespeichert. Für Copilot und lokale Modelle steht daneben eine getrennte persönliche MCP-Erlaubnis. Die Modellwahl allein erteilt keine Datenfreigabe. Eine Workspace-Sperre bleibt wirksam. Für allgemeine MCP-Verbindungen führt dein eigener Worker die Aufrufe aus. Die vorbereitete persönliche AJ-Atlas-Verbindung in den Analytik-Jena-Workspaces kann stattdessen den ONE-Cloud-Proxy verwenden; dafür brauchst du keinen lokalen Worker. Dein eigener Atlas-Zugang bleibt in beiden Fällen nötig; der Modellhost bekommt keine Zugangstokens.


## Atlas Flow in Frankfurt

Das Frankfurter Modell kann die ausgewählten Atlas-Werkzeuge über dieselbe persönliche MCP-Verbindung nutzen: Records lesen und ändern, Agenten und Flows verwalten sowie die verfügbaren Polarion-Werkzeuge aufrufen. Nach der Suche nach einem Werkzeug bekommt das Modell dessen vollständiges Funktionsschema. Auch große Schreibschemas dürfen nicht als „nicht verfügbar“ verschwinden. Die Serverhinweise beschreiben den Aufruf; Rechte und Freigaben gelten weiter.

Eine erfolgreiche Werkzeugauswahl beweist noch keine Ausführung. Prüfe im KI-Terminal den tatsächlichen Aufruf und das Ergebnis. Ein angelegter Flow-Job ist eingereihte Arbeit; ein Agent muss ihn mit seiner eigenen autorisierten Verbindung ausführen. Ein Personentoken macht aus dem Modell keinen Agenten. Schreibrechte, Constraints, Signaturen und menschliche Freigaben werden durch die Modellwahl nicht umgangen.

Polarion Connect benötigt zusätzlich einen erreichbaren, für das Projekt freigegebenen Polarion-Worker und dessen Browser-Anmeldung. Beginne mit `atlas_polarion_status`; eine Atlas-Anmeldung allein beweist keine Polarion-Verbindung. `atlas_polarion_resolve` findet vorhandene Referenzen in Atlas und beweist ebenfalls keine aktuelle Browser-Verbindung. Ein Entwurf von `atlas_polarion_prepare_change` ist noch nicht gespeichert. `atlas_polarion_apply_change` benötigt die ausdrückliche Freigabe der konkreten Vorschau und einen schreibfähigen Worker.

Die technische Anbindung und die Ergebnisqualität werden getrennt geprüft. Ein erfolgreicher Identitäts- oder Suchtest qualifiziert nicht automatisch Agentenläufe, Änderungen oder Polarion. Bei einem Fehler die konkrete fehlende Voraussetzung zeigen; niemals Erfolg oder fehlende Daten aus einem gescheiterten Aufruf ableiten.

Der vorbereitete AJ-Workspace führt den Atlas-Mandanten als expliziten Standard mit. Dieser gilt pro Aufruf, sofern du keinen anderen zugänglichen Mandanten nennst. Deine globale Atlas-Auswahl bleibt erhalten; ein anderer dort ausgewählter Mandant beweist keine fehlenden Projektdaten.

## Kompilierte Aufrufprüfung und Nachweiswürfel

Klappe unter einem tatsächlichen Atlas-Aufruf **Tatsächliches Atlas-Ergebnis** auf und klicke auf **Kompilierte Aufrufprüfung · …**. Der kurze Hash bezeichnet das Prüfprofil, nicht den einzelnen Nachweiswürfel. Die Detailansicht zeigt den gläsernen Würfel, seine vollständige Quantum-ID und die vom Compiler gelieferten Dimensionen. Wähle eine Dimension, um ihren Prüfstatus und die zugehörige Regel zu sehen. Der Würfel lässt sich durch Ziehen oder mit den beiden Drehtasten bewegen.

Unter **Gebundene Werte und Abhängigkeiten**, **Vollständige Hashes** und **Originaldaten des Prüfbelegs** findest du die gespeicherten Prüfdaten. **Prüfbeleg als JSON herunterladen** exportiert sie. Öffnen und Exportieren senden keine neue KI- oder Atlas-Anfrage. Die ausführlichen Compiler-Daten werden nicht zusätzlich als Modellkontext übertragen.

Ein gespeicherter Nachweis beschreibt die damalige Prüfung. Er ist keine erneute Rechteprüfung und belegt weder fachliche Richtigkeit noch den Erfolg einer Atlas-Aktion; deren Rückgabe und gegebenenfalls Rückleseprüfung stehen getrennt daneben. Ältere Kurzbelege enthalten keine Originalausgabe. Ihre Dimensionen werden nur als Katalogzuordnung gezeigt; historische Detaildaten werden nicht nachträglich erfunden.


## Fehler gezielt beheben

Im KI-Terminal und bei der direkten Quellenübergabe zeigt ONE zu einem gescheiterten Aufruf eine kurze Reparaturkarte. **Verbindung prüfen** öffnet die betroffene persönliche Verbindung; die Schaltfläche erteilt keine zusätzlichen Rechte.

- **401 / Anmeldung abgelehnt:** Atlas-Instanz und persönlichen Zugang prüfen. Ein neues Token ist erst nötig, wenn dieses tatsächlich ungültig ist.
- **403 / Rechte fehlen:** Projektmitgliedschaft und Werkzeugrechte prüfen. Das beweist kein ungültiges Token.
- **TLS / Zertifikat:** Firmenzertifikat im Worker prüfen; die Zertifikatsprüfung bleibt eingeschaltet.
- **Zeitüberschreitung / Netzwerk:** Erreichbarkeit vom ausführenden Worker oder Proxy, VPN und DNS prüfen.
- **Werkzeug oder Schema:** Aktuellen Werkzeugkatalog und genaue Argumente prüfen. Keine wirkende Aktion blind wiederholen.
- **Ergebnis oder Kontext zu groß:** Bei Design-Mocks kann ONE die vollständige große MD als Quelle halten und passende Abschnitte für das Modell lesen. Ein Design-Mock braucht keinen Anforderungsrecord, wenn du keinen vorgibst. Für allgemeine Abfragen helfen weniger Records oder gezielte Abschnitte; die Originalquelle bleibt erhalten.

Werkzeugsuche und Identitätsprüfung belegen keine Projektinhalte. Eine fehlgeschlagene Suche bedeutet „nicht geprüft“, nicht „keine Daten vorhanden“. ONE prüft erkennbare falsche Referenzen, Zahlen und Erfolgsaussagen und lässt höchstens eine Antwortkorrektur ohne weitere Werkzeuge zu. Das ersetzt keine fachliche Prüfung.


## Polarion persönlich verbinden

Die FluX-Startseite bereitet über **Polarion verbinden** den Auftrag „Verbinde meinen Polarion-Zugang.“ vor. Mit **STARTEN** erlaubst du gezielt die persönliche Anmeldung über `atlas_polarion_connect`. Dies erlaubt keine Inhaltsänderung, Freigabe oder beliebige Agentenausführung. ONE prüft weiter Identität, Workspace und Datenweg; offene Entscheidungen blockieren auch den Anmeldeschritt. Ein rein lesender Statusauftrag startet keinen Login. Geschützte Anmeldelinks sofort öffnen; Kennwort und MFA nur dort eingeben. Bei `worker_offline` zuerst den bereits zugeordneten Polarion-Worker starten. Die erfolgreiche Atlas-Verbindung allein ist kein Polarion-Login.


## Zugang vor der KI-Aufgabe prüfen
Mit einem verbundenen Worker oder dem vorbereiteten AJ-Atlas-Cloudzugang prüft **Verbindung testen** deinen Zugang und die verfügbaren Werkzeuge direkt. Dafür brauchst du kein Modell; Records werden dabei weder gelesen noch geändert. Ein grüner Verbindungsstatus bestätigt diese Prüfung. Einzelne Projekte und Aktionen haben weiterhin eigene Berechtigungen.

Eine **Nutzungsanweisung generieren** ist eine separate KI-Aktion und benötigt ein eingerichtetes Modell. Auf der Atlas-Startseite werden der geprüfte persönliche Zugang und eine noch fehlende Modelleinrichtung getrennt angezeigt.
