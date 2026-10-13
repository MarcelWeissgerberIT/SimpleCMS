---
id: flight-recorder
title: Flugschreiber
section: writing
order: 14
keywords: flugschreiber, auswerfen, auswurf, zurücknehmen, lauf zurücknehmen, agentenlauf rückgängig, vor dem auswurf, eject, zurückspulen, rückspulen, band, deck, spur, spuren, schreiber, wer war das, wer hat das geändert, was ist passiert, zeitleiste, protokoll, lauf, fähnchen, fenster, lupe, agent, mcp, skript, sync, rückgängig, vorgänge, stellen, fenster lesen, vorfallbericht, bericht, gehalten, seitdem geändert, wort für wort, flight recorder, read window, incident report, rewind, tape, writers, who changed
related: history, custom-agents, mcp-bridge, privacy, lock, preflight, outbox, governor
summary: Jeder Schreibvorgang im Arbeitsbereich auf einem Band, je Schreiber eine Spur — du, das KI-Terminal, jeder Agent, MCP-Clients, Skripte, Sync. Sieh, was zwischen 07:00 und 08:00 passiert ist, und wer es war.
---
In einem Arbeitsbereich schreiben viele: du, das [KI-Terminal](help:agent), [Agenten](help:custom-agents), ein MCP-Client über die [Brücke](help:mcp-bridge), Skripte, der Ordner- oder GitHub-Sync, Automationen. Der [Versionsverlauf](help:history) antwortet für eine Seite; der Flugschreiber für den ganzen Arbeitsbereich: **Was hat sich zwischen 07:00 und 08:00 geändert, und wer war das?**

## Das Deck öffnen
- <kbd>Mod+Alt+Z</kbd> — überall, auch während du in einer Seite schreibst. Auf einer deutschen Tastatur ist es die Taste mit dem Z; <kbd>AltGr</kbd>+Z öffnet es nie.
- **Rückspulen** in der Statusleiste, ⌘K *Zurückspulen*, **Flugschreiber** im Seitenmenü **•••** und im Workspace-Menü der Seitenleiste.
- **Workspace-Einstellungen → Daten → Band öffnen.**

Das Deck dockt unter der Seite an; die Seite bleibt benutzbar, und ein Strich, den du anklickst, öffnet seine Seite über dem Deck. <kbd>Esc</kbd> oder ✕ schließt es. Das KI-Terminal und das Deck teilen sich den Platz: Öffnest du das eine, schließt sich das andere — eine Aufgabe im Terminal läuft weiter.

## Das Band lesen
- **Spuren.** Eine je Schreiber: **Du**, **Rückgängig** (ein Rückgängig, eine wiederhergestellte Version), **KI-Terminal**, **KI-Menü**, jeder Agent mit Namen, jeder MCP-Client, Skripte, Sync, Automationen, Import, Vorlagen. Jede Spur zählt ihre Vorgänge im sichtbaren Ausschnitt. Die Filtertaste (*6/6*) blendet Spuren aus, die du nicht brauchst; One merkt sich das auf diesem Gerät.
- **Vorgänge und Stellen.** Ein *Vorgang* ist eine Änderung eines Schreibers — ein Wert, ein Stück Text, eine Eigenschaft. Tippen zählt als ein Vorgang je Seite alle 30 Sekunden. Eine *Stelle* ist, was sich geändert hat: eine Zeile, eine Seite, die Eigenschaften einer Datenbank, eine Ansicht. Ein Lauf ändert viele Stellen mit vielen Vorgängen: *Lauf 212 · 52 Vorgänge an 37 Stellen*.
- **Fähnchen** markieren Läufe (den Lauf eines Agenten, einen Skriptlauf, eine MCP-Sitzung) an ihrem Anfang. Klick ein Fähnchen, und sein Lauf wird zum **Fenster**: die Kanten auf fünf Minuten nach außen gerundet, das Schild rechts zählt es — Vorgänge, Stellen, hinzugekommene und entfernte Wörter, Zeilen (wie viele neu), Seiten, Schemas, Ansichten.
- **Striche** sind einzelne Vorgänge. Ein Strich mit einer Stelle öffnet diese Seite (Eigenschaften oder eine Ansicht einer Datenbank öffnen die Datenbank); ein Strich mit mehreren listet sie auf.
- **Ein Fenster von Hand.** Auf einer Spur ziehen — oder seine Kanten am Abspielkopf setzen, mit **Beginn hier** / **Ende hier** auf dem Schild (die Tasten <kbd>[</kbd> / <kbd>]</kbd>), auf der Spur mit dem Fokus. Auf dem Handy, wo Ziehen das Band verschiebt, erst die Spur antippen, dann den Abspielkopf bewegen und die Kanten setzen.
- **Schraffiert über alle Spuren, *Aufnahme unterbrochen*:** ein Tab wurde geschlossen, bevor er schrieb, was er aufgezeichnet hatte — diese Strecke ist unbekannt, nicht ruhig.
- **Ausschnitt.** **15 Min · 75 Min · 6 Std · 24 Std**. Der Streifen oben zeigt die letzten 24 Stunden in Viertelstunden — klick hinein, und das Band rückt dorthin. Liegt ein Fenster auf dem Band, gibt ihm die **Lupe** bis zu sechsfachen Platz (nicht bei 15 Min, das ist breit genug).
- **Abspielkopf.** Die orange Linie; der Zähler zeigt ihre Zeit. Die Tasten neben dem Zähler setzen ihn auf den vorigen Lauf, eine Minute zurück, eine Minute vor, und **Jetzt** zurück in die Gegenwart.

Orange markiert den Abspielkopf, das gewählte Fenster, gehaltene Stellen (seitdem geändert) und **Auswerfen** — der Rest des Decks ist Tinte, bis auf die REC-Lampe.

## Ein Fenster lesen
Liegt ein Fenster auf dem Band, drück <kbd>↵</kbd> — auf dem Abspielkopf, einer Spur oder dem Fähnchen eines Laufs (ein Fähnchen klammert zuerst seinen Lauf) — oder **Fenster lesen** auf dem Schild. Ein Strich mit mehreren Stellen hat ebenfalls **Fenster lesen**: genau dieser Vorgang, geklammert.

- **Was sich geändert hat, gruppiert.** Schema, Ansichten, Seiten, Zeilen, neue Zeilen (und was in den Papierkorb ging oder verschoben wurde). Jede Gruppe zeigt drei Stellen und **+ n weitere**; <kbd>↑</kbd> / <kbd>↓</kbd> gehen die Liste durch, <kbd>Pos1</kbd> / <kbd>Ende</kbd> springen, <kbd>↵</kbd> auf **+ n weitere** öffnet die Gruppe. Rechts steht die gewählte Stelle: ihre Vorgänge und wann, der Stand, von dem aus gelesen wird (*Stand vor Lauf 212 · 07:31:21*), wer sie seitdem geändert hat.
- **Werte und Text, Wort für Wort.** Die Eigenschaften einer Zeile vorher → nachher, der Text einer Seite Wort für Wort — in Tinte, wie ein Korrekturabzug. Titel werden live gelesen, die Werte aus den Ständen, die One auf diesem Gerät behalten hat.
- **Gehalten: seitdem geändert.** Eine Stelle, die nach dem Fenster jemand geändert hat — du, jemand aus dem Team, ein anderer Agent, ein Sync — ist *gehalten*: eine Raute auf dem Band und eine orange Markierung in der Liste (*2 Zeilen seitdem geändert (du) — sie werden gehalten*). Was ein anderer Schreiber mitten im Fenster getan hat, ist an seinem Block oder Wert markiert (*enthält Änderungen von …*) und zählt nie zum Fenster.
- **Teilweise.** Ein Fenster, das die Strecke eines Schreibers schneidet (sie begann davor oder ging danach weiter), heißt *Teilweise*; die Taste **Klammer auf … erweitern** (oder **Den ganzen Lauf klammern**) nimmt sie ganz auf.
- **Möglicherweise unvollständig.** Ein Tab hat geschlossen, bevor er aufschrieb, was er im Fenster aufgezeichnet hatte: was er getan hat, ist unbekannt.
- **Nur ungefähr danach.** *Stand danach nur ungefähr*: die Stelle wurde noch einmal geändert, bevor One das Ergebnis des Fensters aufgeschrieben hatte.

Auf dem Telefon ist der Dialog ein Blatt; tipp eine Stelle an, und ihre Werte und ihr Text kommen auf einem zweiten Blatt, **‹ Plan** führt zurück. <kbd>Esc</kbd> schließt erst den Dialog, dann das Deck. Lesen ändert den Arbeitsbereich nie.

## Vorfallbericht
**Bericht** — auf dem Schild oder unten im Dialog — lädt eine Markdown-Datei (`incident-<Datum>-<Uhrzeit>-<Schreiber>.md`): das Fenster, alle Schreiber mit Vorgängen darin, was sich geändert hat (Schema-Änderungen mit Namen, Seiten mit ihren Wortzahlen, Zeilen mit den Namen der geänderten Eigenschaften) und Hinweise (gehalten, teilweise, unvollständig). Er enthält Titel, Namen von Eigenschaften und Optionen, Schreiber, Zahlen und Zeiten — **nie einen Wert, nie eine Zeile Text**. Er entsteht, wenn du die Taste drückst, und wird nirgends gespeichert; was du mit der Datei machst, entscheidest du.

## Ein Fenster auswerfen
**Auswerfen** auf dem Schild nimmt zurück, was in einem Fenster geschrieben wurde — einen ganzen Agentenlauf, eine Terminal-Aufgabe, eine MCP-Sitzung, einen Skriptlauf oder eine Strecke, die du eingeklammert hast — und lässt alles andere, wie es ist. Am Computer liegt die Taste unter einem schraffierten Deckel: erst den Deckel öffnen (Klick oder <kbd>↵</kbd> auf den Deckel); ein anderes Fenster schließt ihn wieder. Die Taste zählt, was zurückginge: **Auswerfen · 35 / 37**.

Die Taste schreibt nie. Sie öffnet den Dialog — *52 Vorgänge von Nordlicht-Spiegel auswerfen?* — mit dem Plan:
- **Was zurückgeht**, gruppiert wie beim Lesen: das Schema (*Option „Ready“ kommt zurück — Board bekommt seine Spalte wieder.*), Ansichten, Seiten, Zeilen. Eine Zeile geht **ganz** zurück — alle Werte und ihr Text, oder nichts; eine Seite geht **Block für Block** zurück, nur die Blöcke, die das Fenster geschrieben hat.
- **Neues geht in den Papierkorb** — Zeilen und Seiten, die das Fenster angelegt hat, kommen in den Papierkorb, gelöscht wird nichts.
- **Gehalten: seitdem geändert.** Eine Stelle, die nach dem Fenster jemand geändert hat (du, eine Kollegin, ein anderer Agent, ein Sync), bleibt, wie sie ist, mit dem Grund in Worten: *Status ist nicht mehr, was Nordlicht-Spiegel hinterließ: Du hast „In Arbeit“ gesetzt. Bleibt, wie es ist.* Ihre Karte auf einem Board und ihre Zeile in einer Tabelle tragen danach die Marke **Gehalten**.
- **Kein genauer früherer Stand.** Eine Stelle, deren Stand vor dem Fenster dieses Gerät nicht genau kennt, bleibt — nie geraten.
- **Aufgaben.** Eine [Aufgabe](help:tasks) wird nie verdoppelt oder verloren: Eine, die jetzt anderswo lebt, bleibt — ebenso eine Aufgabe, die das Fenster angelegt hat, solange eine andere Aufgabe noch auf sie verweist (*Blockiert durch*, *Verknüpft*).
- **Nie ausgeworfen:** die Reihenfolge der Ansichten, Datenbank-Befehle, Vorlagen, Automationen, die Coding-Pipeline, Datensatztypen, eine Eigenschaft eines Datensatztyps, eine Option einer geteilten Liste — und **Erinnerungen**, die du in ihrer Datenbank bearbeitest.

**35 Stellen zurücknehmen** (oder <kbd>↵</kbd>, einen Moment nachdem der Dialog aufging) schreibt es: Zuerst sichert One jede Seite, die sich ändern wird, als Version **Vor dem Auswurf** ([Versionsverlauf](help:history)); dann prüft One den Plan noch einmal — hat sich seit dem Öffnen des Dialogs etwas geändert, wird nichts geschrieben und der Dialog zeigt den neuen Plan zum erneuten Bestätigen; dann geht alles in **einem Schritt** zurück.

### Rückgängig
Die Meldung nach einem Auswurf — *35 Stellen von Nordlicht-Spiegel zurück · 2 gehalten* — hat **Rückgängig** (<kbd>Strg+Z</kbd> / <kbd>⌘Z</kbd>, solange sie zu sehen ist, außer du schreibst gerade in einem Feld oder einer Seite) und **Gehaltene zeigen**. Das Schild behält, was passiert ist — Stellen, was zurückging, Papierkorb, gehalten, die Version — mit **Auswurf zurücknehmen**, auch nachdem das Deck zu war und nach einem Neuladen. Das Rückgängig setzt genau das zurück, was der Auswurf geändert hat, in einem Schritt; eine Stelle, die seitdem wieder geändert wurde, bleibt (*behalten*). Ein Auswurf wird selbst nie ausgeworfen — seine Vorgänge stehen auf der Spur **Rückgängig**, und **Auswurf zurücknehmen** nimmt ihn zurück.

### Was der Auswurf sonst noch erledigt
- **[Agentenläufe](help:custom-agents).** Die Vorschläge des Laufs, die zurückgingen, heißen in seiner Prüfung **Ausgeworfen**, die gehaltenen **Gehalten · seitdem geändert** (weiter übernommen); noch wartende Vorschläge werden verworfen — außer solchen, die du im [Vorflug-Check](help:preflight) geöffnet hast. Rückgängig bringt sie wieder.
- **KI-Terminal, MCP, Skripte.** Eine ausgeworfene Terminal-Änderung ist verworfen, ihr Rückgängig schreibt nichts mehr; ein MCP-Aufruf oder ein Skriptlauf gilt als rückgängig gemacht. Zusammen geschriebene Änderungen — die Bearbeitungen einer Seite, die Aufgaben-Änderungen einer Seite aus einem **Alle übernehmen** — gehen zusammen zurück oder bleiben zusammen. Ein verworfener Vorschlag, der auf einem ausgeworfenen aufbaut, kommt mit seinem eigenen Rückgängig nicht wieder. Das Rückgängig des Auswurfs gibt sie zurück.
- **[Ausgang](help:outbox).** Eine als gesendet markierte Zeile wird gehalten — ein Versand wird nie zurückgenommen. Ungesendete Zettel verworfener Vorschläge werden zurückgezogen und bleiben es auch nach einem Rückgängig; andere Zettel auf Zeilen, die zurückgehen, zeigen **GEÄNDERT**.
- **Coding-Aufgaben.** Felder, die eine Aufgabe bewegen (Stufe, Danach, Repo, Branch), werden nie ausgeworfen. Eine Aufgabe, die den Text eines Agenten zurückbekommt, wartet auf **Bestätigen**, bevor der Worker sie nimmt.
- **Auslöser.** Automationen, von Zeilen ausgelöste Agenten und Autofill reagieren nicht auf einen Auswurf oder sein Rückgängig.
- **Unterbrochen.** Ein Tab, der mitten in einem Auswurf geschlossen wurde, wird beim nächsten Öffnen von One fertig.

Auswerfen geht in lokalen Arbeitsbereichen; Team-Arbeitsbereiche bekommen es später — lesen geht dort.

## Tasten
Wenn der Abspielkopf, eine Spur oder ein Fähnchen den Fokus hat:
- <kbd>←</kbd> / <kbd>→</kbd> — eine Minute zurück / vor, mit <kbd>Shift</kbd> zehn Sekunden
- <kbd>[</kbd> / <kbd>]</kbd> — Anfang / Ende des Fensters am Abspielkopf, auf der Spur mit dem Fokus (Windows mit deutscher Tastatur: <kbd>AltGr+8</kbd> / <kbd>AltGr+9</kbd>, Mac: <kbd>⌥5</kbd> / <kbd>⌥6</kbd>)
- <kbd>↑</kbd> / <kbd>↓</kbd> — die Spur darüber / darunter
- <kbd>Bild↑</kbd> / <kbd>Bild↓</kbd> — das vorige / nächste Fähnchen auf der Spur
- <kbd>Pos1</kbd> / <kbd>Ende</kbd> — Anfang des Ausschnitts / jetzt
- <kbd>↵</kbd> — das Fenster lesen (auf einem Fähnchen: seinen Lauf)
- <kbd>Esc</kbd> — schließen; der Abspielkopf geht zurück auf jetzt

Der Griff an der Oberkante des Decks stellt seine Höhe ein (ziehen, oder <kbd>↑</kbd> / <kbd>↓</kbd> darauf).

## Was gespeichert wird, und wo
- **Nur auf diesem Gerät.** Das Band liegt in diesem Browser (IndexedDB `one-recorder`), 30 Tage zurück. Es wird nie synchronisiert, steht nie in Sicherungen, Exporten oder Freigabelinks und geht nie an Claude.
- **Kein Text, keine Werte.** Das Band enthält IDs, Arten von Änderungen, Zeiten, Zahlen und Fingerabdrücke, gebildet mit einem Schlüssel, den dieser Browser hält und nicht herausgeben kann. Seitentext und Werte von Eigenschaften lassen sich daraus nicht lesen; außerhalb dieses Browserprofils ist es nutzlos. Nur Namen von Eigenschaften, Optionen und Ansichten stehen darin, wo sich die Eigenschaften einer Datenbank geändert haben.
- **Frühere Stände.** Bevor ein Schreiber an einer Stelle beginnt, bewahrt One die Stelle so auf, wie sie war — wie eine Version, auf diesem Gerät, 30 Tage. Endgültiges Löschen einer Seite nimmt sie mit.
- **Platz.** Alle Arbeitsbereiche auf diesem Gerät teilen sich ein Budget (höchstens 250 MB). Das Speichern des Arbeitsbereichs geht immer vor: Wird der Platz knapp, gibt das Band zuerst seine ältesten Tage her und pausiert, wenn nichts mehr herzugeben ist. **Workspace-Einstellungen → Daten** zeigt Tage, Vorgänge und Größe des Bands, und **Band löschen** vergisst das Band dieses Arbeitsbereichs auf diesem Gerät — die Seiten und ihr Verlauf bleiben.
- **Workspace zurücksetzen** und das Entfernen der Kopie eines Team-Arbeitsbereichs aus diesem Browser löschen sein Band mit.
- **Der Regler fügt dem Band nichts hinzu.** Ein [Budget](help:governor) ist eine Einstellung: Es zu speichern ist ein Vorgang wie jede andere Einstellung, und was der Regler ablehnt, pausiert oder anhält, hat den Arbeitsbereich nie erreicht. Was Agenten und Aufgaben vor oder nach einer Rotlinie schreiben, steht wie immer auf dem Band.

## Team-Arbeitsbereiche
Ein Gerät kennt nur, was es gesehen hat: deine eigenen Vorgänge, die Agenten und Terminal-Aufgaben, die in diesem Browser liefen, und eine Spur **Team** für Änderungen, die von deinen Kolleginnen und Kollegen über den Server kamen. Ein anderes Gerät hat sein eigenes Band.

> Lesen ändert den Arbeitsbereich nie; nur **Auswerfen** tut es — nach seinem Dialog, mit einer Version vorher und einem Rückgängig.
