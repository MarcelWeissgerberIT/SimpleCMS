---
id: formulas
title: Formulas
section: databases
order: 3
keywords: formula, calculate, prop, if, concat, dateBetween, round, expression, computed, Formel, berechnen, Formeln
related: properties, custom-functions, spreadsheets, views
summary: A formula property calculates a value for every row from its other properties.
---
1. Add a property of type **Formula**.
2. Click a cell of it: the formula editor opens, with a **Live preview** for real rows (step through them with the arrows).
3. Write the formula, then <kbd>Mod+Enter</kbd> or **Done**.

## The language
- Properties: `prop("Price")`. Text in "quotes", numbers as `1.5`, `true` / `false`.
- Operators: `+ - * / ^`, comparisons `== != > < >= <=`, `and`, `or`, `not`, and `condition ? a : b`.
- Functions — the reference column lists them all; hover for the signature, click to insert:
  - logic: `if`, `and`, `or`, `not`, `empty`
  - text: `concat`, `length`, `contains`, `replace`, `lower`, `upper`, `trim`, `slice`, `format`, `join`
  - math: `round`, `floor`, `ceil`, `abs`, `sqrt`, `pow`, `min`, `max`, `sum`, `toNumber`
  - date: `now`, `today`, `dateAdd`, `dateSubtract`, `dateBetween`, `formatDate`, `year`, `month`

## Examples
```
prop("Price") * 1.19
if(prop("Done"), "✓", "open")
dateBetween(prop("Due"), today(), "days")
```

Errors are marked in place with a short explanation. Your own **custom functions** work here too — e.g. `MARGIN(prop("Price"), prop("Cost"))`.
