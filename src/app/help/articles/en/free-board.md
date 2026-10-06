---
id: free-board
title: Free board and record types
section: databases
order: 12
keywords: free board, record type, record types, type, lanes, lane, cards, mixed, lead, bug, idea, Freies Board, Datensatz-Typ, Spalte
related: views, properties, databases, ai-menu
summary: A board whose cards can be different kinds of things — each record type brings its own fields.
---
A **free board** is a board whose cards don't all have to be the same kind of thing. A lead, a bug and an idea can sit side by side in one lane — each card shows the fields of its own **record type**.

## Make one
- In a page: type **/free board** — an inline database with a free board appears.
- In the sidebar: **+** next to Pages → **New free board** (also in ⌘K).
- On a database: **+** (Add view) → **Free board**. It gets its own lane property.

## Lanes
The lanes are the options of the board's **Lane** property. **+ Lane** at the end adds one. Each lane's **•••** renames it (or double-click its name), changes its colour, moves it left or right, collapses or hides it. Deleting a lane that holds cards asks where they should go.

**Lanes from list**: a lane property bound to a shared list (building blocks) takes the list's items — adding an item to the list adds the lane everywhere the list is used.

## Cards
**+** in a lane offers the record types the board holds, **Plain card** and **New record type…**. A card shows its type's colour bar and the first three filled fields of its type. Drag cards between lanes; with the keyboard, focus a card, press <kbd>Space</kbd>, move with the arrow keys and drop with <kbd>Space</kbd>. On a phone, hold a card to drag it — or use **Move to lane** in its menu (right-click / long-press).

The board's properties come from what you put in: **Properties** lists them per record type, and a card of a new type brings that type's fields along.

## Record types in databases
Any database can hold record types — not only free boards:

- **••• → Record types** lists the types the database holds. Attach one of your types, detach one (its properties stay as plain ones, the rows keep their values), create a new type — empty or **from these properties** — or open it in the building blocks.
- A row page shows its type under the title (**● Lead ▾**): pick, change or clear it there. A row shows the database's own properties plus those of its type; other types' fields are hidden (their values stay).
- **New ▾** offers **New Lead** for every type — the new row starts with the type's content.
- Tables can show a **Type** column (**Properties** → Type). Other types' cells show a dim **—** and can't be edited on that row. Filter, sort and group by Type like any column.
- A page of a type the database doesn't hold yet, dropped into it, brings its type along.

Locked databases keep their types and lanes as they are; cards and rows still move.

## Let Claude build it
Select mixed notes (ideas, bugs, people …) and pick **Turn into free board** in the [AI menu](help:ai-menu) (also under **Transform into…**). Claude proposes record types — reusing yours by name — lanes and cards. The preview shows them; **Transform** puts the board in place of the text in one step, and **Undo** takes it back. Only the selection is sent.
