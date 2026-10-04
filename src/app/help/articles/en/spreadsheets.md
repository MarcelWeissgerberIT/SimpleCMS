---
id: spreadsheets
title: Spreadsheets
section: calculate
order: 1
keywords: spreadsheet, sheet, cells, formula, sum, vlookup, excel, dataset, DS, fill, autocomplete, csv, Tabellenkalkulation, Tabelle, Zellen, SUMME, SVERWEIS, Formel
related: custom-functions, charts, formulas
summary: A real spreadsheet inside a page — several sheets, Excel-style formulas, named datasets.
---
Insert one with `/spreadsheet` (German `/tabellenkalkulation`).

## Cells and formulas
Click a cell and type; start with `=` for a formula: `=SUM(B2:B9)`, `=IF(C2>100; "big"; "small")`, `=VLOOKUP(A2; Prices!A:B; 2)`. Both `;` and `,` separate arguments. **fx** opens the function browser — about 80 functions, searchable by name, purpose or the German Excel name (`SVERWEIS` finds VLOOKUP). Other sheets: `Prices!A1`, or `'Sheet 2'!A1` when the name has a space.

While you type, suggestions show matching functions; click cells or drag a range to insert a reference.

## Sheets, formats, fill
- **+** next to the sheet tabs adds a sheet; a tab's menu renames, duplicates, moves or deletes it.
- The toolbar: bold, italic, alignment, number format (number, percent, currency €/$, date, text), decimals, **Freeze first row**.
- Drag the small square at the corner of a selection to **fill a series** (1, 2, 3 … or dates); double-click it to fill down to the end of the data. **Fill down** / **Fill right** are in the cell menu.
- **AutoComplete cell values** suggests entries already in the column; **Pick from list…** chooses one.

## Datasets
A dataset is a named set of areas. Select one or more areas (<kbd>Mod</kbd>-click adds an area), open **Datasets** → **New dataset from selection**, name it — then use `=SUM(DS(Revenue))`. Datasets have a colour in the grid, and charts can use them.

## On a phone
Tap a cell to select it; tap it again (or hold it) for the cell menu: **Pick a value**, **+ Area**, **Fill ↓**, **Edit**, copy, paste. **+ Area** adds another area like <kbd>Mod</kbd>-click does.

The status line shows SUM, AVG and COUNT of the selection. **•••** downloads a sheet as CSV or imports one.
