---
id: formulas
title: Formeln
section: databases
order: 3
keywords: formel, formeln, berechnen, prop, if, concat, dateBetween, round, ausdruck, formula, calculate
related: properties, custom-functions, spreadsheets, views
summary: Eine Formel-Eigenschaft berechnet für jeden Eintrag einen Wert aus seinen anderen Eigenschaften.
---
1. Leg eine Eigenschaft vom Typ **Formel** an.
2. Klick in eine ihrer Zellen: Der Formeleditor öffnet sich, mit **Live-Vorschau** für echte Einträge (mit den Pfeilen durchblättern).
3. Formel schreiben, dann <kbd>Mod+Enter</kbd> oder **Fertig**.

## Die Sprache
- Eigenschaften: `prop("Preis")`. Text in "Anführungszeichen", Zahlen als `1.5`, `true` / `false`.
- Operatoren: `+ - * / ^`, Vergleiche `== != > < >= <=`, `and`, `or`, `not` und `Bedingung ? a : b`.
- Funktionen — die Referenzspalte listet alle; Maus darüber zeigt die Signatur, Klick fügt ein:
  - Logik: `if`, `and`, `or`, `not`, `empty`
  - Text: `concat`, `length`, `contains`, `replace`, `lower`, `upper`, `trim`, `slice`, `format`, `join`
  - Mathe: `round`, `floor`, `ceil`, `abs`, `sqrt`, `pow`, `min`, `max`, `sum`, `toNumber`
  - Datum: `now`, `today`, `dateAdd`, `dateSubtract`, `dateBetween`, `formatDate`, `year`, `month`

## Beispiele
```
prop("Preis") * 1.19
if(prop("Erledigt"), "✓", "offen")
dateBetween(prop("Fällig"), today(), "days")
```

Fehler werden an der Stelle markiert, mit kurzer Erklärung. Deine **eigenen Funktionen** gehen hier auch — z. B. `MARGIN(prop("Preis"), prop("Kosten"))`.
