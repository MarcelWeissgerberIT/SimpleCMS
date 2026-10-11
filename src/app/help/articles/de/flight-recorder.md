---
id: flight-recorder
title: Flugschreiber
section: writing
order: 14
keywords: flugschreiber, zurückspulen, rückspulen, band, deck, spur, spuren, schreiber, wer war das, wer hat das geändert, was ist passiert, zeitleiste, protokoll, lauf, fähnchen, fenster, lupe, agent, mcp, skript, sync, rückgängig, vorgänge, stellen, flight recorder, rewind, tape, writers, who changed
related: history, custom-agents, mcp-bridge, privacy, lock
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

Orange markiert den Abspielkopf und das gewählte Fenster — der Rest des Decks ist Tinte, bis auf die REC-Lampe.

## Tasten
Wenn der Abspielkopf, eine Spur oder ein Fähnchen den Fokus hat:
- <kbd>←</kbd> / <kbd>→</kbd> — eine Minute zurück / vor, mit <kbd>Shift</kbd> zehn Sekunden
- <kbd>[</kbd> / <kbd>]</kbd> — Anfang / Ende des Fensters am Abspielkopf, auf der Spur mit dem Fokus (Windows mit deutscher Tastatur: <kbd>AltGr+8</kbd> / <kbd>AltGr+9</kbd>, Mac: <kbd>⌥5</kbd> / <kbd>⌥6</kbd>)
- <kbd>↑</kbd> / <kbd>↓</kbd> — die Spur darüber / darunter
- <kbd>Bild↑</kbd> / <kbd>Bild↓</kbd> — das vorige / nächste Fähnchen auf der Spur
- <kbd>Pos1</kbd> / <kbd>Ende</kbd> — Anfang des Ausschnitts / jetzt
- <kbd>Esc</kbd> — schließen; der Abspielkopf geht zurück auf jetzt

Der Griff an der Oberkante des Decks stellt seine Höhe ein (ziehen, oder <kbd>↑</kbd> / <kbd>↓</kbd> darauf).

## Was gespeichert wird, und wo
- **Nur auf diesem Gerät.** Das Band liegt in diesem Browser (IndexedDB `one-recorder`), 30 Tage zurück. Es wird nie synchronisiert, steht nie in Sicherungen, Exporten oder Freigabelinks und geht nie an Claude.
- **Kein Text, keine Werte.** Das Band enthält IDs, Arten von Änderungen, Zeiten, Zahlen und Fingerabdrücke, gebildet mit einem Schlüssel, den dieser Browser hält und nicht herausgeben kann. Seitentext und Werte von Eigenschaften lassen sich daraus nicht lesen; außerhalb dieses Browserprofils ist es nutzlos. Nur Namen von Eigenschaften, Optionen und Ansichten stehen darin, wo sich die Eigenschaften einer Datenbank geändert haben.
- **Frühere Stände.** Bevor ein Schreiber an einer Stelle beginnt, bewahrt One die Stelle so auf, wie sie war — wie eine Version, auf diesem Gerät, 30 Tage. Endgültiges Löschen einer Seite nimmt sie mit.
- **Platz.** Alle Arbeitsbereiche auf diesem Gerät teilen sich ein Budget (höchstens 250 MB). Das Speichern des Arbeitsbereichs geht immer vor: Wird der Platz knapp, gibt das Band zuerst seine ältesten Tage her und pausiert, wenn nichts mehr herzugeben ist. **Workspace-Einstellungen → Daten** zeigt Tage, Vorgänge und Größe des Bands, und **Band löschen** vergisst das Band dieses Arbeitsbereichs auf diesem Gerät — die Seiten und ihr Verlauf bleiben.
- **Workspace zurücksetzen** und das Entfernen der Kopie eines Team-Arbeitsbereichs aus diesem Browser löschen sein Band mit.

## Team-Arbeitsbereiche
Ein Gerät kennt nur, was es gesehen hat: deine eigenen Vorgänge, die Agenten und Terminal-Aufgaben, die in diesem Browser liefen, und eine Spur **Team** für Änderungen, die von deinen Kolleginnen und Kollegen über den Server kamen. Ein anderes Gerät hat sein eigenes Band.

> Das Deck liest nur. Es ändert den Arbeitsbereich nie — zurück geht es mit dem [Versionsverlauf](help:history) oder der Prüfung eines Agentenlaufs.
