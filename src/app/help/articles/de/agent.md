---
id: agent
title: Das KI-Terminal
section: ai
order: 3
keywords: mock, mocks, png, html, designsystem, design system, prototyp, atlas, ba, po, anforderungen, requirements, s9, agent, ki-terminal, terminal, claude, automatisieren, massenänderung, aufgaben, aufgaben-blöcke, list_work_items, update_work_item, verantwortlich, fällig, einträge, seiten, datenbanken, board, übernehmen, prüfen, tastatur, befehle, referenzen, kontext, was claude liest, neu machen, ändern, ersetzen, umschreiben, diff, unterseite pro eintrag, seite pro ticket, tabelle mit links, limit, weitermachen, weiter, pipelines, coding-aufgabe, freigeben, verbinden, anmelden, mcp, workspace agent, AI terminal, context, edit, continue, connect
related: custom-agents, governor, ai-menu, mcp-servers, mcp-bridge, coding-pipeline, pipelines
summary: Gib Claude Aufgaben per Tastatur — es liest deinen Workspace, schlägt Änderungen vor, und du übernimmst sie. Arbeitet auch ausgeblendet weiter.
---
Drück <kbd>Mod+J</kbd> (oder ⌘K → *KI-Terminal*, oder **KI** in der Statusleiste). Das Terminal dockt unter der Seite an — die Seitenleiste bleibt —, auf dem Handy füllt es den Bildschirm.

1. Tipp eine Aufgabe, z. B. *„Mach aus den Meeting-Notizen dieser Woche Aufgaben in Projekte“* oder *„Mach ein Board aus den offenen Punkten dieser Seite“*, und drück <kbd>Enter</kbd> (<kbd>Shift+Enter</kbd> für eine neue Zeile).
2. Claude durchsucht und liest deine Seiten und Datenbanken; die Antwort läuft live ein, jeder Tool-Aufruf ist eine Zeile im Protokoll (`→ search_pages "Delta"`, `✓ create_row … vorgemerkt #2`).
3. Änderungen werden **vorgeschlagen**, nicht geschrieben: neue Seiten, Einträge, Datenbanken und Eigenschaften, geänderte Werte und Titel landen in einer Prüfliste. Einzeln übernehmen, **Alle übernehmen** (<kbd>Mod+Enter</kbd> oder `/übernehmen`) oder verwerfen. Ein **Rückgängig** nimmt einen übernommenen Stapel zurück.

## Große Aufträge aufteilen

Bei umfangreichen Repository-Analysen bietet das Terminal **Auftrag in 4 Schritte aufteilen** an: Überblick, ein Feature am Code prüfen, belegte Requirements formulieren und geprüfte Teile zusammenführen. **Schritt vorbereiten** setzt nur einen bearbeitbaren Entwurf ins Eingabefeld. Erst **Starten** führt ihn aus. Der ursprüngliche Auftrag lässt sich wiederherstellen.

Für Polarion-Exporte lautet die Reihenfolge: Quellen festlegen → native PDF aus Polarion exportieren → Original als Anhang in ONE ablegen → auf ausdrücklichen Wunsch nach Atlas übertragen. Suchtreffer und KI-Zusammenfassungen ersetzen keine Original-PDF. Ist kein Export- oder Upload-Werkzeug verfügbar, bleibt dieser Schritt offen; die PDF kann in Polarion exportiert und an ONE angehängt werden.

## Wenn eine Antwort von dir fehlt

**Deine Antwort wird benötigt** bleibt über dem Protokoll sichtbar. **Jetzt antworten** führt zur konkreten Frage. Eine angebotene Option sendet deine Antwort sofort; alternativ kannst du eine eigene Antwort eingeben und **Antwort senden und fortsetzen** wählen. Solange du nicht antwortest, pausiert der abhängige Schritt. Die Anzeige unterscheidet dieses Warten von einem technischen Fehler.

## BA und PO · Anforderungen prüfen

Öffne die Seite mit dem tatsächlichen Sachverhalt und starte im Terminal **`/ba S9`** oder **`/po S9`**. Ohne Zusatz analysiert `/ba` die geöffnete Seite. Ein Ticketkürzel wie S9 muss genau eine vorhandene Überschrift treffen; ONE begrenzt dann die Quellen auf diesen Abschnitt. Freier Text wie `/ba Zeitstempel-Präzision` beschreibt ein Thema für die gesamte Seite.

Der gewählte Anbieter bleibt aktiv — auch **Atlas Flow · Frankfurt**. Zwei getrennte Modellanfragen liefern:

1. **BA:** bis zu drei konkrete Anforderungsentwürfe, Originalstellen, unterscheidbare Prüffälle und fehlende Angaben.
2. **PO:** Prüfung jeder Anforderung und ihrer Prüffälle gegen dieselben Originalstellen; offene Spezifikation und mögliche Widersprüche bleiben sichtbar.

Bei den Prüffällen gilt dieselbe Anforderungsbedingung: Eine hypothetische Beobachtung erfüllt die Anforderung, eine andere verletzt sie. Aus „Wenn A, dann B“ folgt kein „Wenn nicht A, dann nicht B“. Fehlerreaktionen, für die die Quelle keine Vorgabe enthält, bleiben offen.

Die Fortschrittszeilen zeigen **1/2 · BA** und **2/2 · PO**. ONE prüft die Struktur, echte Quellenverweise, unbelegte Zahlenwerte und den Seitenstand. Eine technisch fehlerhafte Antwort darf sich einmal pro Runde korrigieren. Gesperrter Kontext oder eine inzwischen geänderte Quelle hält den Lauf an.

Der Bericht ist **nur ein Entwurf im Terminal**. Es werden keine Seiten geändert, keine Atlas-Einträge angelegt und keine Entscheidungen freigegeben. Quelle ist der gelesene ONE-Schnappschuss mit Zeit und Fingerabdruck; **Atlas wird in diesem Ablauf nicht neu abgefragt**. Eine zweite Anfrage beim selben Modell ist keine unabhängige fachliche Abnahme. Prüffälle sind Vorschläge, keine ausgeführten Tests. Wiederhole den Ablauf mit `/ba` oder `/po`; die Modellantwort darf dabei unterschiedlich ausfallen.

## Eine Seite pro Eintrag
Bitte um *„eine Unterseite für jedes Ticket, verlinkt in einer Tabelle auf dieser Seite“* — die Tickets dürfen von der Seite, aus einer Datenbank oder von einem [MCP-Server](help:mcp-servers) wie deinem Tracker kommen. Claude merkt alle Seiten in einem Schritt vor (bis zu 50 pro Aufruf, jede ein eigener Vorschlag in der Prüfliste), dann eine Tabelle auf der Hauptseite — der offenen Seite, wenn du *diese Seite* oder *Hauptseite* sagst — mit einem Link auf jede Seite und den wichtigsten Feldern der Einträge (Status, Zuständig, Datum …) als Spalten. Nach **Alle übernehmen** sind die Links Seiten-Erwähnungen: ein Klick öffnet die Unterseite. Haben die Einträge gemeinsame Felder und willst du lieber eine Tabelle oder einen Tracker, legt Claude eine [Datenbank](help:databases) mit einem Eintrag pro Punkt an.

## Bestehenden Text ändern
Claude ergänzt eine Seite per *Anhängen*. Verlangt eine Aufgabe, Vorhandenes zu **korrigieren, umzuschreiben, zu aktualisieren oder zu entfernen**, ändert es stattdessen genau diese Blöcke: Es liest die Seite mit einer kurzen Marke je Block (`b3`) und nennt die Blöcke, die es ändert — ersetzen, löschen, danach einfügen oder die ganze Seite neu schreiben, wenn du das willst. Jede Änderung ist ein eigener Vorschlag, gezeigt als **Diff** der Seite: entfernte Wörter rot durchgestrichen, neue orange hinterlegt, unveränderte Blöcke eingeklappt (*12 unveränderte Blöcke — anzeigen*).

- Jede Änderung einzeln übernehmen oder verwerfen. Was du von einer Seite zusammen übernimmst, geht in einem Schritt hinein: Vorher wird eine Version gesichert (**KI** im [Versionsverlauf](help:history)), und <kbd>Mod+Z</kbd> auf der offenen Seite nimmt die ganze Änderung zurück.
- Einen Block, den du geändert hast, nachdem Claude den Vorschlag gemacht hat, **überspringt** One — er wird nie überschrieben, die Prüfung sagt es dir.
- Blöcke, die du vom Lesen ausgenommen hast (siehe unten), kann Claude auch nicht ändern; die ganze Seite neu schreiben wird dann abgelehnt.
- [Eigene Agenten](help:custom-agents) können auch Änderungen vorschlagen; selbst ein Agent, der direkt schreibt, wartet auf dein OK, bevor er Text ersetzt.

## Aufgaben-Blöcke
Claude schreibt [Aufgaben](help:tasks) als `> [!TODO] Titel` mit einer Feldzeile (*Owner: Alex · Due: 2026-10-17 · Blocked by: …*) in Seiten — One macht daraus Aufgaben-Blöcke mit eigenen IDs; die Antwort des Werkzeugs nennt Claude die ID jeder neuen Aufgabe. Es findet Aufgaben im ganzen Arbeitsbereich (**list_work_items**: offen, meine, blockiert, überfällig, nach Person, Seite oder Titel) und ändert Status, Termin, Erinnerung, Verantwortliche oder Verknüpfungen einer Aufgabe (**update_work_item**). Das ist nicht die Coding-Pipeline: Deren Aufgaben haben eigene Werkzeuge (unten).

- Die Prüfung zeigt jede Aufgabe als Zeile: **AUFGABE · NEU** mit ihren Chips (Status, Termin, Verantwortliche, blockiert durch), **BEIBEHALTEN**, **GEÄNDERT** mit jedem Feld vorher → nachher, **ENTFERNT**, wenn ein Umschreiben eine weglässt. Eine Zeile **Wartet auf deine Prüfung · Nennt eine Person** (oder *Setzt eine Erinnerung*, *Ändert eine zugewiesene Aufgabe*, *Fügt einen Blocker hinzu*, *Entfernt Aufgaben*) sagt, worauf du schauen solltest.
- Verantwortliche sind nur Personen deines Arbeitsbereichs: Ein unbekannter Name wird mit der Liste der Namen abgelehnt, und Claude fragt neu — One legt nie eine Person an und nennt Claude nie eine E-Mail-Adresse.
- Verknüpfungen erreichen nur Aufgaben, die Claude lesen darf (was **Was Claude liest** erlaubt; eine Aufgabe außerhalb wird nur mit ihrer ID genannt). Wartet eine Aufgabe auf eine, die ein anderer Vorschlag anlegt, braucht sie diesen Vorschlag zuerst — allein übernommen, sagt One das.
- Die Feldzeile einer Aufgabe im Text zu bearbeiten ändert nichts; die Prüfung sagt es. Text, der das Zitat einer Aufgabe mit ihrem `{#wi_…}` behält, behält die Aufgabe — lässt er es weg, wird sie entfernt (als **ENTFERNT** gezeigt).

## Coding-Pipelines aus dem Terminal
Nutzt du die [Coding-Pipelines](help:coding-pipeline), kann Claude sie lesen — was auf dich wartet, die Stufe einer Aufgabe, ihren Plan, das Testergebnis und das Protokoll — und **vorschlagen**, worum du bittest: eine neue Aufgabe (Coding, Business-Analyse oder QA) oder eine Aktion an einer: freigeben, mit Anweisungen zurückschicken, ihre Frage beantworten, einmal ausführen, stoppen, *Danach* setzen oder übergeben.

- Jede solche Änderung ist ein Vorschlag in der Prüfliste wie alle anderen. Eine neue Aufgabe zeigt sich **vollständig**: Projekt, Repo, Branch, wo sie startet und anhält, ihre ganze Seite genau so, wie Claude Code sie liest (die Box scrollen), und die Seiten, die mitgehen. Eine Freigabe zeigt den Plan, den sie freigibt, und was danach von selbst läuft.
- Vorschläge, die den **Worker** auf deinem Rechner **starten**, tragen **STARTET WORKER** und sind nie Teil von *Alle übernehmen* (<kbd>a</kbd>, `/übernehmen`, <kbd>Mod+Enter</kbd>): Übernimm jeden mit seiner Taste **Übernehmen** oder <kbd>Enter</kbd> darauf. Genauso Text, den Claude einer Aufgabenseite anfügt (**GEHT AN CLAUDE CODE**, vollständig gezeigt): Claude Code liest ihn in der nächsten Stufe der Aufgabe, zusammen mit den Seiten, die er verlinkt — die Karte nennt sie, und eine Seite, die Claude dazu vorschlägt, wird ebenfalls vollständig gezeigt. *Danach* startet nichts sofort — eine Aufgabe der genannten Pipeline startet, wenn diese fertig ist; eine fertige Aufgabe übergibst du mit *Übergeben*.
- Eine Aufgabe, die anderswo geschrieben oder geändert wurde (auf einem anderen Gerät oder von einem Agenten), zeigt **ERST BESTÄTIGEN**: Übernehmen wird abgelehnt, bis du auf der Aufgabenseite **Auf diesem Gerät bestätigen** drückst — das Terminal bestätigt nie für dich.
- Hat sich eine Aufgabe bewegt, geändert oder eine neue Frage bekommen, nachdem Claude die Aktion vorgeschlagen hat, wird sie abgelehnt (*inzwischen geändert — frag noch einmal*). Rückgängig lässt eine übernommene Aufgabenaktion stehen: Der Worker hat vielleicht schon angefangen.
- `/pipelines` (oder `/pipelines qa`) listet die offenen Aufgaben — was auf dich wartet zuerst — mit **Öffnen** und, bei einer laufenden, **Stopp**.
- Claude kann keine Aufgabe in eine beliebige Stufe schieben, Repo oder Branch einer Aufgabe ändern, sie bestätigen, Freigaben ändern, Git-Befehle ausführen oder die Pipeline bearbeiten.

## Einen MCP-Server verbinden
Grundlegende ONE-Lesewerkzeuge sind bei werkzeugfähigen lokalen Modellen bereits geladen. Fehlende erlaubte Lesebeschreibungen kann ONE begrenzt selbst nachladen; du musst keine Werkzeuge installieren. Die persönliche Atlas-Verbindung und ihre Berechtigungen bleiben erforderlich.

Nach einem Atlas-Schreibzugriff unterscheidet ONE **Lesen fehlgeschlagen** von **Lesen erfolgreich, gespeicherte Fassung weicht ab**. Beispielsweise kann Atlas Texte beim Speichern übersetzen. Eine Abweichung bleibt zur inhaltlichen Prüfung offen; sie ist kein Tokenfehler und keine bestätigte Übereinstimmung. Vor einem erneuten Sync die bereits angelegten Records prüfen.

`/verbinden` listet deine [MCP-Server](help:mcp-servers) und wie sie stehen. `/verbinden wiki` (ein Name, ein Codewort wie `kb:` oder eine Adresse) meldet an — das Anmeldefenster öffnet sich direkt mit deinem <kbd>Enter</kbd> — oder testet den Server nur, wenn sein Token funktioniert. `/verbinden https://…` fügt zuerst einen neuen Server hinzu. Scheitert eine Aufgabe, weil ein Server sein Token abgelehnt hat, steht **Bei <Server> anmelden** darunter (oder drück <kbd>Enter</kbd> in der leeren Eingabe); ist er verbunden, führt **Aufgabe erneut ausführen** (<kbd>Enter</kbd>) sie mit der neuen Anmeldung aus.

## Es arbeitet weiter
Blende das Terminal mit <kbd>Esc</kbd> oder <kbd>Mod+J</kbd> aus und arbeite weiter — die Aufgabe läuft weiter. Die Statusleiste zeigt **KI · arbeitet** und danach **KI · 3 Änderungen zu prüfen**; eine Meldung sagt Bescheid, wenn sie fertig ist, ein Klick holt das Terminal zurück. Nur **Stopp** beendet eine Aufgabe: <kbd>Mod+.</kbd>, <kbd>Ctrl+C</kbd> (ohne Markierung), `/stopp` oder die Stopp-Taste. Die bisherigen Vorschläge bleiben.

**An der Rotlinie.** Ist ein [Budget](help:governor) gesetzt, wartet eine Aufgabe, deren nächster Schritt die Linie reißen würde, **zwischen zwei Schritten** mit einer Haltekarte — solange sie wartet, wird nichts gesendet und nichts reserviert. **E** erlaubt 1 $ mehr für diese Aufgabe und heute, **H** stellt mit einem günstigeren Modell desselben Anbieters fertig, wenn es das Gespräch tragen kann, <kbd>Mod+.</kbd> stoppt (vorgemerkte Änderungen bleiben). `/kosten` zeigt zusätzlich den Rest des Tages.

## Kontext
- Die **offene Seite** geht als Chip mit — entfern sie mit ×, wenn es nicht um sie geht.
- **Referenzen:** Markiere Text auf einer Seite und drück **Zum Terminal** in der Werkzeugleiste oder <kbd>Mod+Shift+J</kbd> (auch auf schreibgeschützten Seiten und in Datenbank-Einträgen). Die Stelle wird zum Chip; bis zu 10 gehen mit der nächsten Aufgabe als Markdown samt Seite mit und wandern dann in deren Protokollzeile. <kbd>Rücktaste</kbd> am Anfang der Eingabe entfernt den letzten Chip.
- **Erwähnungen:** Tipp `@` und einen Teil eines Titels, dann <kbd>Tab</kbd>: Die Seite oder Datenbank geht als Kontext mit. `one:` zeigt zuerst die Seiten und Einträge auf der Ebene der offenen Seite (dann eine Titelsuche); `<Codewort>:` am Anfang (z. B. `kb:`) zeigt die Werkzeuge dieses [MCP-Servers](help:mcp-servers) – eines wählen, und Claude nutzt es.

## Was Claude liest
Der Chip der offenen Seite sagt, wie viel Claude davon lesen darf: nur der Titel bei der ganzen Seite, *· 3 Blöcke* bei markierten Blöcken, *· nichts*, wenn du sie ausgenommen hast. Ein Klick auf den Chip bietet **Ganze Seite**, **Nur markierte Blöcke**, **Blöcke markieren…** (oder `/kontext`) und **Nichts von dieser Seite** — dieselben Markierungen wie im [KI-Menü](help:ai-menu). Dann liefern `read_page` (und die Suche) von dieser Seite nur die markierten Blöcke oder halten sie zurück, und Claude erfährt das; Schreiben auf die Seite geht wie gewohnt, mit deiner Prüfung. Andere Seiten sind nicht betroffen; Referenzen schicken weiter genau den markierten Text. `/neu-machen` markiert Stellen der offenen Seite, die Claude mit Vorgaben neu macht.

## Tasten und Befehle
- <kbd>↑</kbd> / <kbd>↓</kbd> in der ersten / letzten Zeile: frühere Eingaben (die letzten 50 auf diesem Gerät und in diesem Workspace, nie synchronisiert).
- <kbd>Tab</kbd> ergänzt `/Befehle`, `@`-Erwähnungen, `one:` und die Werkzeuge eines Codeworts; bei leerer Eingabe springt es in die Prüfliste.
- <kbd>Enter</kbd> in der leeren Eingabe: eine am Limit angehaltene Aufgabe **weitermachen**, dich bei einem Server **anmelden**, der sein Token abgelehnt hat, oder die Aufgabe nach dieser Anmeldung **erneut ausführen**.
- In der Prüfliste: <kbd>j</kbd> / <kbd>k</kbd> (oder Pfeile) bewegen, <kbd>Leertaste</kbd> markiert, <kbd>Enter</kbd> übernimmt die markierten (oder den aktuellen) Einträge, <kbd>a</kbd> übernimmt alle (außer denen, die an den Coding-Worker gehen), <kbd>d</kbd> verwirft, <kbd>o</kbd> öffnet die Seite, <kbd>u</kbd> macht das letzte Übernehmen rückgängig, <kbd>Esc</kbd> führt zurück zur Eingabe.
- <kbd>Alt+↑</kbd> / <kbd>Alt+↓</kbd> oder Ziehen an der Oberkante ändern die Höhe; Maximieren füllt den Inhaltsbereich.
- `/neu` (oder `/leeren`) beginnt neu · `/stopp` · `/weiter` (eine am Limit angehaltene Aufgabe geht weiter) · `/übernehmen` · `/verwerfen` · `/verlauf` · `/verlauf-leeren` (vergisst die Eingaben des Workspace auf diesem Gerät — nach einem *y / n*) · `/mcp` (verwendete Server) · `/pipelines` (offene Pipeline-Aufgaben) · `/verbinden` (bei einem MCP-Server anmelden, ihn testen, einen hinzufügen) · `/kosten` (Tokens und Kosten je Modell) · `/kontext` (was Claude auf der offenen Seite liest) · `/neu-machen` (Stellen mit Vorgaben neu machen) · `/merken <Satz>`, `/ohne-gedächtnis`, `/beispiel <Tag>` ([One-Gedächtnis](help:memory)) · `/hilfe`. Die englischen Namen gehen auch: `/new` (`/clear`), `/stop`, `/continue`, `/apply`, `/discard`, `/history`, `/clear-history`, `/connect`, `/cost`, `/context`, `/redo`, `/remember`, `/no-memory`, `/example`, `/help`.

## Gut zu wissen
- Claude kann Datenbanken anlegen (eine Tabelle oder ein Board, gruppiert nach einer Spalte) und Eigenschaften ergänzen und sie in derselben Aufgabe mit Einträgen füllen. Gesperrte Datenbanken lehnen neue Eigenschaften ab.
- Eine Aufgabe hat ein Budget von **120 Tool-Aufrufen**. Das ist die Zahl der einzelnen Aufrufe, nicht der verfügbaren Werkzeuge. Von ONE ausgeführte MCP-Suchen und MCP-Aufrufe zählen mit. Kontext-, Kosten- und Schleifenschutz gelten weiterhin und können früher stoppen. Am Aufruflimit fasst die KI zusammen, und die Aufgabe zeigt **Limit erreicht** mit der Taste **Weitermachen** — oder drück <kbd>Enter</kbd> in der leeren Eingabe oder tipp `/weiter`: Dieselbe Aufgabe geht mit neuem Budget im selben Gespräch weiter; was vorgemerkt ist, bleibt und wird nicht doppelt vorgemerkt. Hinzugefügte MCP-Server stehen zur Verfügung.
- Die Anzeige zeigt Tokens (rein, Cache schreiben / lesen, raus) und was die Unterhaltung nach Ones Preistabelle gekostet hat ([was KI-Anfragen kosten](help:ai-costs); `≈` nur, wenn eine Antwort abbrach und geschätzt wurde) — Anthropic rechnet über deinen Schlüssel ab. Nichts ändert sich, bevor du übernimmst; im Team-Workspace sehen Leser die Vorschläge, können sie aber nicht übernehmen.
- Das [One-Gedächtnis](help:memory) geht mit jeder Aufgabe mit (**GEDÄCHTNIS · 3** im Kopf), und nach einer Aufgabe schlägt Claude vielleicht vor, was es sich merken soll — gespeichert nur mit deinem OK. `#tag` nimmt ein gespeichertes Beispiel ganz mit.

## Kompilierter Auftrag und Entscheidungswürfel

Öffne **Kompilierter Auftrag** unter deiner Anfrage. Der Auftragscompiler bindet Ziel, Rollen-Anweisungen, Eingabefingerabdruck, Quellenverweise, Nutzer und Workspace. Sein JSON-Paket wird als Systemkontext an das Modell übergeben. Die sieben Dimensionen zeigen die tatsächlich ausgeführten, begrenzten Prüfungen. Unter **Tatsächlich kompiliertes Modellpaket** und **Vollständiger Prüfnachweis des Hosts** kannst du sie einsehen; Frankfurter Live-Tests zeichnen diese Host-Prüfungen auch im persönlichen Live-Protokoll auf.

Wähle unter **Entscheidungswürfel und kompilierte Dimensionen** eine Dimension: Die aktive Ebene und ihre Bezugswürfel mit Verbindungen zum Kern wechseln anhand der aufgezeichneten Compiler-Prüfungen. Die Nummern passen zur Liste unter dem Bild; Nachweise zeigen ihre tatsächliche ID. Gestrichelte Würfel stehen für offene Prüfungen ohne aufgezeichneten Nachweis. Gehört derselbe Nachweis zu mehreren Dimensionen, behält er seine Nummer und ID. Die Auswahl startet keine neue KI- oder MCP-Anfrage.

Fehlt eine Voraussetzung, prüft die KI zuerst die verfügbaren ONE- und Atlas-Quellen. Werkzeugsuche ist kein Quellenabruf. Bleibt die Information offen oder eine Quelle unerreichbar, fragt der Entscheidungswürfel konkret nach und benennt den abhängigen Schritt. Wähle eine Option oder formuliere deine Spezifikation. Nur eure Eingabe löst die Frage auf und bindet eine neue Vertragsversion; sie erweitert keine Werkzeugrechte. Unabhängige Lesezugriffe bleiben erlaubt, abhängige Wirkungen sind blockiert. Hintergrundagenten halten bei solchen Fragen an: Ergänze ihre Aufgabe und starte sie erneut.

Eine Analyse darf offene Fragen als Ergebnis benennen, ohne dich dafür anzuhalten. Der Entscheidungswürfel ist für eine Antwort nötig, ohne die der angeforderte nächste Schritt nicht fortgesetzt werden kann. Fordert das Modell die Entscheidung vor der Quellenprüfung an, erhält es einen begrenzten Korrekturhinweis. Das öffnet keine Entscheidung, beantwortet nichts für dich und gewährt keine zusätzlichen Rechte.

**Bereit zur Prüfung** bestätigt technische Auftragsgrenzen, beobachtete Werkzeugdaten und das Ausgabeformat. Es beweist weder jede Aussage noch fachliche Vollständigkeit. **Ergebnis von mir geprüft** zeichnet eure Prüfung auf und wendet Vorschläge nicht automatisch an. Bestehende Datenschutz- und Werkzeugfreigaben gelten zusätzlich. Unbekannte Wirkungen oder veraltete Nutzer-, Workspace- und Anbieterbindungen sperren die Ausführung.

## Gespeicherte Kompilate wiederholen

Öffne **Kompilate** im Kopf des KI-Terminals. Nach einem erfolgreichen normalen Lauf kannst du im aufgeklappten **Kompilierten Auftrag** auch **Als ausführbares Kompilat speichern** wählen. ONE übernimmt die tatsächlich erfolgreichen Werkzeugaufrufe und ihre Reihenfolge als prüfbaren Entwurf. Reine Textantworten ohne Werkzeugaufrufe ergeben noch keinen ausführbaren Ablauf.

1. Name und Definition prüfen, **Kompilieren und speichern**. Die persönliche Bibliothek gehört nur deinem Konto in diesem Workspace. Cloud-Versionen sind verschlüsselt gespeichert und von anderen Mitgliedern nicht abrufbar; lokale Workspaces speichern auf diesem Gerät.
2. Eine feste Version wählen. Eingaben sind JSON-Werte: zum Beispiel `"seiten-id"`, `42` oder `{"ref":42}`. Lesende Argumente dürfen geprüfte Vorgaben haben; Argumente für Änderungen und nachfolgende Aufrufe nach einer Änderung müssen neu angegeben oder an frische Schrittergebnisse gebunden werden. Frühere generierte Inhalte werden nicht automatisch als neue Eingaben übernommen.
3. **Diese Version ausführen** nutzt das aktuell gewählte Terminal-Modell und deine aktuellen persönlichen Verbindungen. Bei Wirkungen erst die sichtbaren Eingaben und Werkzeugschritte prüfen. ONE-Änderungen bleiben Vorschläge; externe Schreibzugriffe oder Ausführungen laufen innerhalb deiner Rechte direkt.
4. Quellen werden neu gelesen. Benötigte Entscheidungen werden im Entscheidungswürfel erneut abgefragt. Geänderte Schemata, fehlende Bindungen oder entzogene Rechte stoppen den Lauf; es gibt keine automatische Werkzeugersetzung und keinen automatischen Neustart eines schreibenden Schritts.
5. Unter **Laufnachweise** stehen die letzten 100 Läufe mit Artefakt-Hash, Version, eigener Lauf-ID, Modell, Eingabe-/Ergebnishashes pro Schritt und Antwort oder Fehler. Nach einem Abbruch nach externen Wirkungen zuerst den tatsächlichen Stand prüfen, bevor du neu startest.

**Als neue Version bearbeiten** verändert die alte Version nie. Der Hash bezeichnet die kanonisch kompilierte JSON-Definition: feste Werkzeuge, Reihenfolge, Datenbindungen und Generierungsanweisungen. Die Ausführung interpretiert diese geprüfte Zwischenrepräsentation; sie führt keinen JavaScript-Code aus. Generierungsschritte haben keine Werkzeuge, können aber jedes Mal anders formulierte Antworten liefern. Ein gleicher Ablauf garantiert weder gleichen Wortlaut noch fachliche Richtigkeit; die Abnahme bleibt beim Menschen.

In der erweiterten Definition bindet `{"input":"name"}` einen Eingabeparameter, `{"result":"schritt_id","path":["id"]}` einen Wert aus einem früheren Schrittergebnis und `{"literal":…}` einen festen JSON-Wert. `object` und `array` setzen solche Bindungen zusammen. Bei einem `generate`-Schritt können ein festes JSON-Schema und die frisch gelesenen Quellen als Kontext gebunden werden; spätere Werkzeugschritte können einzelne Felder daraus verwenden. Das Modell wählt dabei keine neuen Werkzeuge. Unbekannte Ergebnispfade oder nicht unterstützte Schema-Prüfungen stoppen vor der betroffenen Wirkung.

Im festen Generierungsschritt entfallen die exakten allgemeinen ONE-Anleitungen zur freien Werkzeugplanung. Eigene Rollenregeln, persönliche MCP-Vorgaben, Datenfreigaben und Rechteprüfungen bleiben erhalten. Das kompilierte Ziel ist die tatsächliche Nutzeranweisung; der gelesene Quelltext bleibt getrennte Nutzdaten und wird nicht noch einmal als Auftragsziel mitgesendet.

Ein MCP-Werkzeugschritt kann in der erweiterten JSON-Definition `"decode":"mcp-json"` verwenden. Das verlangt genau eine erfolgreiche Textantwort mit JSON-Inhalt. Frische Daten stehen danach unter `source`, Host-Belege getrennt unter `oneObservedFacts`. Eine Bindung wie `{"result":"atlas","path":["source","item","body"]}` gibt nur das tatsächliche Body-Feld weiter; fehlende Pfade oder ungeeignete Antworten stoppen den Schritt. Damit müssen große Metadaten nicht mit an das Modell.


## Eine vorhandene Seite anhand einer URL überarbeiten

Öffne die Zielseite und schreibe zum Beispiel: **„Schreibe diese Seite anhand dieser EARS-Beschreibung neu: https://alistairmavin.com/ears/“**. In einem angemeldeten Team-Workspace liest ONE die Zielseite und die ausdrücklich angegebene öffentliche HTTPS-Quelle vor dem Entwurf selbst. Links aus der Quelle werden nicht automatisch verfolgt.

Der geführte Ablauf bindet die Änderung an die ursprüngliche Seite. Er gibt dem Modell nummerierte Originalstellen vor; ONE übernimmt den belegten Wortlaut und setzt Anforderung, Prüfkriterium und Originalstelle selbst zur Nachweistabelle zusammen. Vorhandene Ticket-Links und Branch-Referenzen werden erhalten. Bei EARS müssen konkrete Anforderungssätze mit Originalbezug und Prüfkriterien vorliegen; eine Tabelle mit Stichworten reicht nicht. Ein unpassender Entwurf erhält genau einen Korrekturversuch. Bleiben die Mindestprüfungen offen, wird kein Ersatzdokument vorgemerkt.

Die Prüfung belegt Quellenabruf, Zitatübereinstimmung, Seitenziel und Mindeststruktur. Sie bestätigt weder fachliche Richtigkeit noch eine Entscheidung des Teams. Du siehst weiterhin einen Diff und übernimmst ihn selbst. Bei nicht lesbaren URLs importiere den Originaltext als externe Quelle; ONE ersetzt ihn nicht durch Modellwissen.

## Code-Ausgaben prüfen

Ein Codeblock ist noch kein Build-Nachweis. ONE erkennt einige konkrete C++-Mängel bereits statisch, etwa fehlende direkte Integergrenzen-Header und problematische Zeichenprüfung. Im lokalen Modellkanal und bei Copilot wird dafür höchstens eine werkzeugfreie Korrektur angefordert; wiederholt fehlerhafte Entwürfe werden angehalten. Diese schmale Vorprüfung ersetzt weder Kompilieren noch Tests oder Security-Review. Nutze dafür die Prüfphase der Repository-Aufgabe im Worker.
# BA-/PO-Mocks aus dem aktuellen Atlas-Designsystem

Öffne das KI-Terminal und starte zum Beispiel:

```text
/mock Erstelle für Atlas-Record 32155 einen Entwurf der Konfliktanzeige. Nutze das aktuell gültige FluX-Designsystem und die Anforderungen dieses Records. Zeige offene Designfragen.
```

Für einen freien Mock reichen eine ausdrücklich ausgewählte Design-MD und dein Auftrag. Der Anforderungs-Record ist optional. ONE lädt die vollständige MD über deine persönliche Atlas-Verbindung (bis 8 MiB Antwortgröße im Cloud-Zugang) und behält sie nur für diesen Lauf. Die KI erhält kleine, genaue Ausschnitte mit Designwerten und passenden Komponenten. Eine ausgewählte Referenz wird dadurch nicht als verbindlicher oder freigegebener Designstand ausgegeben. Ohne ausdrücklich ausgewählte Referenz muss die KI den geltenden Designkatalog und seine Versionsregel ermitteln. Bei großen Katalogen kann sie mit `read_design_source` gezielt echte Komponenten-, Token- und Versionspassagen lesen. Suchtreffer oder ein Modellgedächtnis ersetzen diese Quellen nicht. Fehlt eine verbindliche Version oder Komponente, muss die KI zuerst die Quellen prüfen und gegebenenfalls eine konkrete Frage stellen.

Die Mock-Karte zeigt einen **statischen HTML-/CSS-Entwurf** mit Komponenten- und Anforderungsbezug. PNG wird aus genau diesem HTML gerendert. HTML, PNG und ein JSON-Quellennachweis lassen sich herunterladen. Für die optionale Ablage gibst du die globale Record-Nummer aus dem Atlas-Permalink `/r/…` an. **„Am Atlas-Record ablegen“** speichert alle drei Dateien am gewählten Zielrecord über `atlas_attach`. ONE verwaltet diese Dateien nicht als Dokumentenablage und verändert dabei keine ONE-Seite. Für diese direkte Dateiablage wird die vorbereitete persönliche AJ-Atlas-Verbindung eines Cloud-Workspaces benötigt; ein alter lokaler Worker hat noch eine kleinere Dateigrenze.

Vor der Ablage liest ONE die verwendeten Atlas-Quellen erneut und vergleicht die Inhaltsstände. Geänderte oder unzugängliche Quellen stoppen die Ablage. Danach bestätigt Atlas Größe und SHA-256 jeder Datei. Teilweise erfolgreiche Übertragungen werden einzeln angezeigt; eine Wiederholung verwendet dieselben Dateinamen für denselben Entwurf. Die Dateien bleiben **Entwürfe**, keine freigegebenen Spezifikationen.

Die automatischen Prüfungen belegen Zitatursprung, Komponentenbezüge, einige Tokenregeln und statisches HTML ohne Skripte oder externe Ressourcen. Sie beweisen weder fachliche Vollständigkeit noch eine pixelgenaue Umsetzung des Designsystems. Externe Schriftdateien und Bilder werden in dieser ersten statischen Variante nicht nachgeladen; fehlende Ressourcen und Interaktionen gehören in die offenen Punkte. BA und PO prüfen insbesondere Zustände, Ausnahmen, Prioritäten und Abnahmekriterien. Die KI trifft keine fachlichen Entscheidungen.

Wenn du die konkreten Quellen kennst, kann ONE ihre Abrufe selbst kontrollieren:

`/mock Ein Dialog für Atlas-Record 32155. Lies ref 1174 als Designregel und ref 1179 als aktuellen Katalog. Nur Vorschau, nichts speichern.`

ONE liest diese drei ausdrücklich genannten Records über deinen persönlichen Atlas-Zugang, übergibt genaue Quellenausschnitte und ein vollständiges Ausgabeschema. Es gibt höchstens eine Korrektur. Bei fehlenden Quellen oder gescheiterten Prüfungen entsteht kein Ersatz-Mock. Zitate, statisches HTML und Token-Verweise sind Mindestprüfungen; fachliche Vollständigkeit und visuelle Übereinstimmung bleiben menschlich zu prüfen.

Mit `/pm 9602 <Auftrag>` liest ONE deine persönliche Atlas-Identität und genau den genannten Record selbst. Bis zu drei Refs sind mit Komma möglich. Das Modell erstellt daraus ohne eigene Werkzeuge ein kurzes PM-Lagebild mit wörtlichen Belegen, höchstens drei offenen Fragen und einem vorgeschlagenen nächsten Schritt. Es werden keine Entscheidungen getroffen oder Inhalte geschrieben. Nur die genannten Bodies werden frisch gelesen; Kommentare und Anhänge bleiben ausdrücklich ungeprüft.


## Würfel-Profile und Kompilierung

Öffne im Kopf des KI-Terminals **Würfel-Profile**. Im Dialog erklärt die anklickbare Grafik den Weg von Auftrag und Profil über Rust/WebAssembly, Werkzeugprüfung und echte Belege bis zur Ergebnisprüfung und menschlichen Abnahme. Sie erklärt den Ablauf; echte Laufnachweise findest du in der Karte **Kompilierter Auftrag**.

Wähle eine Dimension am Glaswürfel. Die klickbare Legende benennt Kanten und Gegenprüfungen anderer Dimensionen. Eine Gegenprüfung ist eine ergänzende Anforderung, kein Beweis, dass fachliche Widersprüche ausgeschlossen sind.

Du kannst Pflichtquellen als ONE-Seiten-IDs oder globale Atlas-Refs festlegen, echte Inhaltsabrufe verlangen, diese vor Effekten erzwingen, auf reine Lesezugriffe einschränken oder Atlas-Schreibziele begrenzen. Bei einer Liste erlaubter Schreibziele sind neue Records ohne feste Ziel-Ref blockiert. JSON und wörtliche Ergebnisbegriffe sind formale Prüfungen. Fachliche Hinweise werden an das Modell gegeben und bleiben bis zu deiner Abnahme offen.

**Version speichern und aktivieren** gilt ab dem nächsten Terminal-Lauf, unabhängig vom gewählten unterstützten Anbieter. **Nur Version speichern** ändert die aktive Auswahl nicht. **Zusatzprofil ausschalten** nutzt wieder die Basisprüfungen. Jede Aufgabe behält ihre gebundene Version und deren Hash. Die Bibliothek ist privat auf diesem Gerät, getrennt nach Workspace und Konto; keine Zugangsdaten hineinschreiben.

Ein Profil erteilt keine Zugriffsrechte und lockert keine Anbieterregeln. Es garantiert keine fachliche Wahrheit. ONE-Änderungen müssen separat übernommen werden; erlaubte externe Schreibzugriffe können bereits während des Werkzeugaufrufs wirksam werden.

## Fehler direkt an der Eingabe

Der Fehler der jüngsten Aufgabe steht fest oberhalb der Eingabe, auch wenn die Vorschlagsliste lang ist. Dort kannst du den Auftrag zum Korrigieren übernehmen, zu seinem Verlauf springen oder bei Verbindungsfehlern die passende Einrichtung öffnen. Es wird nichts automatisch wiederholt. Prüfe vor einem neuen Start bereits ausgeführte externe Aktionen. Fehlt bei einer echten Seitenüberarbeitung der Kontext, kannst du die offene Seite ausdrücklich wieder als Kontext auswählen.


## Meine Kompilate

**Meine Kompilate** in der Seitenleiste öffnet deine interne ONE-Datenbank. Sie ist außerdem über die Suche (⌘K → Meine Kompilate), den Terminal-Button **Kompilate** und `/kompilate` erreichbar. Du siehst ausschließlich deine Einträge im aktuellen Workspace; auch andere Teammitglieder und Workspace-Administratoren erhalten darüber keinen Zugriff auf deine Bibliothek. Im Team-Workspace liegen Einträge und Laufnachweise verschlüsselt auf dem Server, im lokalen Workspace in diesem Browser.

Fertige, quellenbasierte Terminal-Aufträge werden automatisch gespeichert. Angehaltene oder fehlgeschlagene Aufgaben und Anmeldungen werden nicht automatisch zu ausführbaren Kompilaten. Die Suche findet Namen und Hashes; **Alle Versionen zeigen** blendet frühere unveränderliche Fassungen ein. Wähle einen Eintrag, prüfe Eingaben und drücke **Diese Version ausführen**. Unter **Laufnachweise** stehen Ergebnisse, Fehler und die Bindung an die ausgeführte Version. Eine fertige Analyse bleibt ein Vorschlag zur fachlichen Prüfung.

BA-, PO-, PM- und Mock-Aufträge speichern ein Rezept mit Ziel und Quellenbezügen. Ein neuer Lauf liest die gebundene ONE-Seite bzw. die genannten Atlas-Records und das aktuelle Designsystem neu. Er startet ohne früheres Gespräch und ohne übernommene Entscheidungen oder Freigaben. Eine fehlende Quellenseite oder geänderte persönliche MCP-Adresse stoppt den Lauf. Die aktuell offene Seite wird nicht als Ersatz verwendet. Mocks werden neu erstellt und erst nach einer gesonderten Aktion am Atlas-Record abgelegt; ONE wird dadurch nicht zur Dokumentenablage.

Ein festes Werkzeug-Kompilat behält seine Reihenfolge und Schemas. Ein Analyse-Rezept durchläuft die aktuellen Fachprüfungen. Beide verwenden das aktuell gewählte Modell und deinen persönlichen Zugang; generierte Texte und neue Quellen können zu anderen Ergebnissen führen.


### Neue BA-/PO-Aufgabe ohne JSON

Wähle **Neue BA-/PO-Aufgabe**, dann eine vorhandene Quellenseite und BA oder PO. Für den Ausschnitt bietet ONE die echten Überschriften dieser Seite an; ein eigenes Thema bleibt möglich. **Rezept speichern und Start prüfen** legt nur deinen privaten Auftrag an. Es startet keine KI und ändert nichts in Atlas. Mehrdeutige Überschriften werden vor der Modellanfrage zur Auswahl zurückgegeben. Große Quellen brauchen einen begrenzten Abschnitt oder markierte Blöcke; Text wird nicht stillschweigend aus der BA-Quellenliste entfernt.

Eingaben eines gespeicherten Kompilats erscheinen als passende Felder: Text, Zahl, Ja/Nein, vorgegebene Auswahl oder Unterfelder. **Als JSON bearbeiten** bleibt für komplexe Werte verfügbar. Eigene Texte bleiben frei; feste Vertragsauswahlen bleiben verbindlich. **Prüfen, was noch fehlt** prüft lokal Werte, Quellenauswahl, Verbindungsdefinition und aktuelle KI-Konfiguration, ohne eine Modellanfrage oder externe Aktion. Es ist kein Atlas-Verbindungstest und ersetzt die aktuelle Prüfung beim Start nicht.

### Ablauf, Würfel und Nachweise

Nach Auswahl eines Kompilats kannst du zwischen **Auftrag und Start**, **Ablauf und Blöcke**, **Quantenraum** und **Laufnachweis** wechseln. Der Ablauf zeigt die gespeicherten Schritte und Datenbezüge. Er stellt keine Gedanken des Modells dar. Im Quantenraum lassen sich Würfel direkt oder über die Legende wählen; **Dimensionsschnitt** hebt die Bezüge der gewählten Dimension hervor. Das Detail zeigt Prüfung, Zustand, Kennung und Abhängigkeiten.

Neue Laufnachweise speichern die tatsächlichen Host-Prüfungen, beobachteten Quellen-/Werkzeugschritte und das kompilierte Modellpaket. Über 120.000 Zeichen bleibt dessen Hash erhalten und die Auslassung wird ausdrücklich angezeigt. Das ist kein vollständiges Anbieter-Transportprotokoll und kein Beweis fachlicher Richtigkeit. Bei älteren Läufen ohne diesen Nachweis zeigt ONE nur die vorgesehenen, noch offenen Prüfungen. Historische Nachweise erlauben keine neue Aktion.

Die Übersicht lädt zuerst Metadaten; vollständige persönliche Antworten und Würfel werden erst beim Öffnen eines Laufs geladen. Ein Fehler bleibt auch dann sichtbar, wenn eine Teilantwort vorliegt. Fehlgeschlagene Vorprüfungen eines gespeicherten Auftrags erhalten ebenfalls einen Laufnachweis; sie erzeugen kein neues ausführbares Kompilat.
## UI-Mock als Seitenblock

Tippe im Seiteneditor `/mock` und wähle **UI-Mock aus Atlas**. Trage die URL der Design-MD und deinen freien Auftrag ein. Der Anforderungs-Record in Atlas ist optional. **Im KI-Terminal vorbereiten** öffnet den normalen `/mock`-Auftrag zur Prüfung; sende ihn dort ab.

Wenn der Entwurf fertig ist, wähle ihn im Block unter **Ergebnis aus dem KI-Terminal** und drücke **Vorschau in Block übernehmen**. Die statische Vorschau bleibt auf der Seite gespeichert und lässt sich im Vollbild öffnen. Lesen oder Neuladen startet keinen KI-Aufruf. Die Vorschau ist ein gespeicherter Stand; Änderungen in Atlas werden erst durch einen neuen Auftrag berücksichtigt. HTML-/PNG-Export und die Ablage am Atlas-Record bleiben in der Mock-Karte im Terminal verfügbar.
