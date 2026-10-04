---
id: spreadsheets
title: Tabellenkalkulation
section: calculate
order: 1
keywords: tabellenkalkulation, tabelle, tabellenblatt, zellen, formel, summe, sverweis, excel, datenbereich, ds, ausfüllen, autovervollständigen, csv, spreadsheet, sum, vlookup
related: custom-functions, charts, formulas
summary: Eine echte Tabellenkalkulation in der Seite — mehrere Blätter, Excel-Formeln, benannte Datenbereiche.
---
Einfügen mit `/tabellenkalkulation` (englisch `/spreadsheet`).

## Zellen und Formeln
Zelle anklicken und tippen; mit `=` beginnt eine Formel: `=SUM(B2:B9)`, `=IF(C2>100; "groß"; "klein")`, `=VLOOKUP(A2; Preise!A:B; 2)`. Argumente trennst du mit `;` oder `,`. Funktionsnamen sind die englischen Excel-Namen. **fx** öffnet die Funktionsübersicht — rund 80 Funktionen, durchsuchbar nach Name, Zweck oder dem deutschen Excel-Namen (`SVERWEIS` findet VLOOKUP). Andere Blätter: `Preise!A1`, oder `'Tabelle 2'!A1`, wenn der Name ein Leerzeichen hat.

Beim Tippen schlägt One passende Funktionen vor; Zellen anklicken oder einen Bereich ziehen fügt den Bezug ein.

## Blätter, Formate, Ausfüllen
- **+** neben den Blatt-Reitern fügt ein Blatt hinzu; das Menü eines Reiters benennt um, dupliziert, verschiebt oder löscht.
- Die Werkzeugleiste: fett, kursiv, Ausrichtung, Zahlenformat (Zahl, Prozent, Währung €/$, Datum, Text), Nachkommastellen, **Erste Zeile fixieren**.
- Zieh das kleine Quadrat an der Ecke einer Auswahl, um eine **Reihe auszufüllen** (1, 2, 3 … oder Daten); Doppelklick füllt bis zum Ende der Daten. **Nach unten ausfüllen** / **Nach rechts ausfüllen** stehen im Zellmenü.
- **AutoVervollständigen für Zellwerte** schlägt Einträge vor, die schon in der Spalte stehen; **Aus Liste auswählen…** wählt einen.

## Datenbereiche
Ein Datenbereich ist eine benannte Menge von Bereichen. Wähle einen oder mehrere Bereiche (<kbd>Mod</kbd>-Klick fügt einen hinzu), öffne **Datenbereiche** → **Neuer Datenbereich aus Auswahl**, benenne ihn — dann `=SUM(DS(Umsatz))`. Datenbereiche haben eine Farbe im Raster, und Diagramme können sie nutzen.

## Auf dem Handy
Zelle antippen wählt sie; nochmal antippen (oder halten) öffnet das Zellmenü: **Wert wählen**, **+ Bereich**, **Füllen ↓**, **Bearbeiten**, Kopieren, Einfügen. **+ Bereich** fügt einen weiteren Bereich hinzu wie <kbd>Mod</kbd>-Klick.

Die Statuszeile zeigt SUMME, MITTEL und ANZAHL der Auswahl. **Mehr** lädt ein Blatt als CSV herunter oder importiert eine.
