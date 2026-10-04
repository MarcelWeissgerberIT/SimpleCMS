---
id: custom-functions
title: Eigene Funktionen
section: calculate
order: 2
keywords: eigene funktion, funktion bauen, ohne code, MARGIN, formel, wiederverwenden, custom function
related: spreadsheets, formulas
summary: Bau deine eigene Formelfunktion per Klick — und nutze sie in Tabellen und Datenbankformeln.
---
Öffne den Baukasten mit ⌘K → *Eigene Funktionen*, oder **Funktionen bearbeiten…** in der Funktionsübersicht einer Tabelle. **Neue Funktion**:

1. **Name der Funktion** — GROSSBUCHSTABEN, Ziffern und `_`, z. B. `MARGIN`. Kein eingebauter Name und nichts, das wie eine Zelle aussieht (`AB12`).
2. **Beschreibung** — erscheint in den Funktionslisten.
3. **Parameter** — die Werte, die hineingehen, je mit Name und Typ: Zahl, Text, Datum, Ja/Nein, Datenbereich (DS) oder beliebiger Wert.
4. **Formel** — per Klick zusammenbauen: jeden leeren Platz mit einem Wert, einem Parameter, einem Operator oder einer Funktion füllen. **In Funktion einpacken…**, **Ersetzen…** und **Auspacken** formen sie um; <kbd>Mod+Z</kbd> macht rückgängig.
5. Der **Prüfstand** rechnet sie beim Bauen mit Beispielwerten durch.
6. **Speichern**.

## Verwenden
- In einer Tabellenzelle: `=MARGIN(B2; C2)`
- In einer Datenbankformel: `MARGIN(prop("Preis"), prop("Kosten"))` — siehe [Formeln](help:formulas)

Umbenennen aktualisiert jede Stelle, die die Funktion nutzt. Löschen einer genutzten Funktion fragt nach — dort stünde dann `#NAME?`. Funktionen gehören zum Workspace (im Team-Workspace kann sie jede:r nutzen).
