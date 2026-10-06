---
id: free-board
title: Freies Board und Datensatz-Typen
section: databases
order: 12
keywords: freies board, datensatz-typ, datensatz-typen, typ, spalten, spalte, karten, gemischt, lead, fehler, idee, free board, record type, lane
related: views, properties, databases, ai-menu
summary: Ein Board, dessen Karten verschiedene Dinge sein dürfen — jeder Datensatz-Typ bringt seine eigenen Felder mit.
---
Ein **freies Board** ist ein Board, dessen Karten nicht alle von derselben Art sein müssen. Ein Lead, ein Fehler und eine Idee können nebeneinander in einer Spalte liegen — jede Karte zeigt die Felder ihres eigenen **Datensatz-Typs**.

## Anlegen
- Auf einer Seite: **/freies Board** tippen — eine Inline-Datenbank mit freiem Board erscheint.
- In der Seitenleiste: **+** neben Seiten → **Neues freies Board** (auch in ⌘K).
- An einer Datenbank: **+** (Ansicht hinzufügen) → **Freies Board**. Es bekommt eine eigene Spalten-Eigenschaft.

## Spalten
Die Spalten sind die Optionen der Eigenschaft **Spalte**. **+ Spalte** am Ende legt eine an. Das **•••** einer Spalte benennt sie um (oder Doppelklick auf den Namen), ändert die Farbe, schiebt sie nach links oder rechts, klappt sie ein oder blendet sie aus. Wer eine Spalte mit Karten löscht, wird gefragt, wohin die Karten sollen.

**Spalten aus Liste**: Ist die Spalten-Eigenschaft an eine geteilte Liste (Bausteine) gebunden, kommen die Spalten aus der Liste — ein neuer Eintrag dort ergibt überall eine neue Spalte.

## Karten
**+** in einer Spalte bietet die Datensatz-Typen des Boards, **Einfache Karte** und **Neuer Datensatz-Typ …** an. Eine Karte zeigt den Farbbalken ihres Typs und die ersten drei gefüllten Felder ihres Typs. Karten zieht man zwischen Spalten; mit der Tastatur: Karte fokussieren, <kbd>Leertaste</kbd>, mit den Pfeiltasten bewegen, mit <kbd>Leertaste</kbd> ablegen. Am Telefon die Karte halten und ziehen — oder im Kartenmenü (Rechtsklick / langes Tippen) **In Spalte verschieben** wählen.

Die Eigenschaften des Boards kommen aus dem, was man hineinlegt: **Eigenschaften** listet sie pro Datensatz-Typ, und eine Karte eines neuen Typs bringt dessen Felder mit.

## Datensatz-Typen in Datenbanken
Jede Datenbank kann Datensatz-Typen halten — nicht nur freie Boards:

- **••• → Datensatz-Typen** zeigt die Typen der Datenbank. Einen deiner Typen hinzufügen, einen lösen (seine Eigenschaften bleiben als normale, die Zeilen behalten ihre Werte), einen neuen Typ anlegen — leer oder **aus diesen Eigenschaften** — oder ihn in den Bausteinen öffnen.
- Eine Zeilenseite zeigt ihren Typ unter dem Titel (**● Lead ▾**): dort wählen, ändern oder entfernen. Eine Zeile zeigt die eigenen Eigenschaften der Datenbank plus die ihres Typs; Felder anderer Typen sind ausgeblendet (ihre Werte bleiben).
- **Neu ▾** bietet für jeden Typ **Neu: Lead** an — die neue Zeile startet mit dem Inhalt des Typs.
- Tabellen können eine Spalte **Typ** zeigen (**Eigenschaften** → Typ). Zellen anderer Typen zeigen ein blasses **—** und lassen sich in dieser Zeile nicht bearbeiten. Nach Typ filtern, sortieren und gruppieren wie nach jeder Spalte.
- Eine Seite eines Typs, den die Datenbank noch nicht hat, bringt ihren Typ mit, wenn man sie hineinzieht.

Gesperrte Datenbanken behalten ihre Typen und Spalten, wie sie sind; Karten und Zeilen lassen sich weiter verschieben.

## Von Claude bauen lassen
Gemischte Notizen markieren (Ideen, Fehler, Personen …) und im [KI-Menü](help:ai-menu) **In freies Board verwandeln** wählen (auch unter **Verwandeln in …**). Claude schlägt Datensatz-Typen vor — deine eigenen nach Namen wiederverwendet —, dazu Spalten und Karten. Die Vorschau zeigt sie; **Verwandeln** setzt das Board in einem Schritt an die Stelle des Texts, **Rückgängig** nimmt es zurück. Gesendet wird nur die Markierung.
