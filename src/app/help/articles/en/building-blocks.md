---
id: building-blocks
title: Building blocks — lists, own types, record types
section: databases
order: 12
keywords: building blocks, kit, shared list, list, options, own property type, custom type, property type, script, validate, format, computed value, onChange, record type, Bug, Lead, IBAN, traffic light, team, confirm, review, Bausteine, Liste, eigener Typ, Datensatz-Typ
related: properties, one-script, databases, team-cloud
summary: Shared lists every select can use, your own property types with a look and small scripts, and record types — sets of properties a row carries.
---
**Building blocks** in the sidebar (or ⌘K → *Building blocks*, `#/kit`) holds the parts your databases are made of. Three tabs:

## Lists
A list is a set of choices many databases share — federal states, currencies, cost centres.
- **New list**, then type items one by one — or **paste many lines** at once (bullets and numbers are dropped).
- Rename an item in place, pick its colour, reorder by dragging or **Alt+↑ / ↓**.
- Deleting an item that rows still use asks first: **Remove anyway**, or **Replace with…** another item.
- **Fill with Claude**: describe the items (“all German federal states”, “ISO currencies”) — Claude proposes them, you tick which ones go in. Only your request and the list's names are sent; pick a page and Claude may also read it (its context marks apply).
- In a database: the property type menu → **Bind to a list…** → *Select* or *Multi-select*. The property always offers the list's items; a new option typed there goes into the list.
- From a page: select lines or a bulleted list → AI menu → *More* → **Turn into list** (nothing is sent anywhere).

## Own property types
An own type is a standard type with your rules. **New property type** asks how values are **stored** (text, number, select, date …, or *Free* = text shaped by scripts) — that base is fixed once created. Then:
- **Options from** a list (select bases), number format, stars.
- **Display**: prefix, suffix, colour and style — plain, badge, LED or bar.
- **Scripts** in [One Script](help:one-script), each with templates and **Test on a row**:
  - **Value** — computes the value from the row (`row`). The cell is read-only and shows ƒ; it is recomputed when the row changes, when it shows, and with **Recompute values** in the property menu.
  - **Validate** — checks what someone types: `true` accepts, a text refuses with that message and the value is **not written**.
  - **Options** — the picker's choices: a list of texts or `{name: "High", color: "red"}`.
  - **Format** — the text a cell shows instead of the stored value.
  - **On change** — runs after a change (`value`, `old`, `row`), like a script run: mail, Claude and the web are asked first.

Three examples:
```
# Validate: only addresses of one domain
let answer = true
if value and not ends_with(lower(value), "@example.com") {
  answer = "Use an address @example.com"
}
answer
```
```
# Value: a traffic light from a number
let light = "Green"
if row.Score < 70 { light = "Yellow" }
if row.Score < 40 { light = "Red" }
light
```
```
# Options: the open projects
db("Projects").where(Status != "Done").sort(title).map(x => x.title)
```
Use it in a database: the property type menu shows it under **Building blocks**. A failing script never breaks a table — the cell shows the stored value with ⚠.

## Record types
A record type — “Bug”, “Lead”, “Invoice” — is a named set of properties (standard types, own types, lists) plus the content a new record starts with. A database holding the type gets all its properties; when you **Save**, every database holding it follows (a locked database stays as it is). Removing a property from the type keeps it in the databases as a plain one, with its values.

## In a team
Lists and types are shared with everyone in the workspace. Scripts run with **your** rights on your device, so a type's scripts run only in a version **this device saved or confirmed**: after a teammate changes them, cells show the stored values and a **REVIEW** chip — open it, read the code, **Confirm**. Value and on-change scripts of a shared row never read your private pages.
