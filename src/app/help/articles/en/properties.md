---
id: properties
title: Properties
section: databases
order: 2
keywords: property, column, field, type, select, status, date, number, person, relation, rollup, files, checkbox, rating, id, Eigenschaft, Spalte, Feld, Relation, Rollup, key, unique, only by hand, Schlüssel, eindeutig, Nur von Hand
related: formulas, views, ai-autofill, subitems
summary: Properties are the columns of a database — text, numbers, dates, relations and more.
---
Add one with **+** at the end of the table header (or **Add a property** in a row page). Typing a new name directly offers **Create property “…”** and asks for the type.

## Types
Text, Number, Select, Multi-select, Status, Date, Person, Checkbox, URL, Email, Phone, Files & media, Rating, ID — plus computed ones: **Formula**, **Rollup**, **Created time**, **Last edited time**, **Created by**, **Last edited by**.

- **Number:** format (number, with commas, percent, euro, US dollar, pound) and **Show as** number, bar or ring.
- **Status:** options in three groups — To-do, In progress, Complete.
- **Date:** with an end date, a time and a **Remind** option.

## Relations and rollups
A **Relation** links rows of one database to rows of another (or the same). **Show on …** makes it two-way: the other database gets a matching property and every link appears on both sides.

A **Rollup** reads through a relation: choose the **Relation**, the **Property** in the other database and what to **Calculate** — count, sum, average, earliest date, percent checked …

## The property menu
Click a column header: rename, change the **Type**, **Hide in view**, **Wrap content**, insert left or right, **Duplicate property**, **Delete property**, **AI autofill…**.

## Key and Only by hand
Two switches in the property menu are about agents:
- **Key** — a text, number or URL property that identifies a row (a ticket number, an order code, an address). Every row's value is unique; empty is allowed. A database has one key; a value another row holds is refused with a note at the cell. Agents find rows by it when they keep a database in step with another system.
- **Only by hand** — agents (custom agents, the AI terminal, MCP clients) never write this property; you edit it as usual. Use it for your own notes, ratings or decisions next to mirrored data.

The column header shows a small key or hand. A locked database keeps both as they are. The two switches appear while an active [integration](help:integrations) unlocks them; without one, a key or *Only by hand* that is set shows as a mark — and still holds for every writer.
