---
id: custom-functions
title: Custom functions
section: calculate
order: 2
keywords: custom function, own function, build function, no code, MARGIN, formula, reuse, Eigene Funktionen, Funktion bauen
related: spreadsheets, formulas
summary: Build your own formula function by clicking — then use it in spreadsheets and database formulas.
---
Open the builder with ⌘K → *Custom functions*, or **Edit functions…** in a spreadsheet's function browser. **New function**:

1. **Function name** — CAPITALS, digits and `_`, e.g. `MARGIN`. It must not be a built-in name or look like a cell (`AB12`).
2. **Description** — shown in the function lists.
3. **Parameters** — the values that go in, each with a name and a type: number, text, date, yes/no, dataset (DS) or any value.
4. **Formula** — click it together: fill each empty slot with a value, a parameter, an operator or a function. **Wrap in function…**, **Replace…** and **Unwrap** reshape it; <kbd>Mod+Z</kbd> undoes.
5. The **Test bench** runs it with sample values while you build.
6. **Save**.

## Use it
- In a spreadsheet cell: `=MARGIN(B2; C2)`
- In a database formula: `MARGIN(prop("Price"), prop("Cost"))` — see [Formulas](help:formulas)

Renaming a function updates every place that uses it. Deleting one that is used asks first — those places would show `#NAME?`. Functions belong to the workspace (in a team workspace, everyone can use them).
