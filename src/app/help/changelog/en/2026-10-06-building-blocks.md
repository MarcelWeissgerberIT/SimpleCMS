---
id: 2026-10-06-building-blocks
date: 2026-10-06
order: 2
title: Building blocks — shared lists, your own property types, record types
summary: Make the parts your databases are built from: lists every select can share (paste them, or let Claude fill them), own property types with a look and small scripts that check, compute and format values, and record types.
image: assets/shots/changelog/building-blocks.webp
alt: The own type “IBAN” on the Building blocks page — its display (a blue badge) with a live preview, its validate script in the One Script editor, and “Test on a row” refusing “DE00 1234” with “Not a valid IBAN”
help: building-blocks, one-script
try: kit
---
**Building blocks** (sidebar, ⌘K, `#/kit`) has three tabs:

- **Lists** — shared choices like federal states or cost centres. Paste many lines at once, reorder with Alt+↑ / ↓, and **Fill with Claude** (“all ISO currencies”): you tick what goes in. In a database: **Bind to a list…**. Removing an item rows still use asks first — remove, or replace it with another item. From a page: AI menu → **Turn into list**.
- **Property types** — a standard type with your rules: prefix, suffix, colour, a badge / LED / bar style, and [One Script](help:one-script) bindings — **value** (computed, read-only ƒ), **validate** (a text refuses the input), **options**, **format**, **on change** (mail and the web are asked first). Each has templates and **Test on a row**.
- **Record types** — a named set of properties (“Bug”, “Lead”) plus the content a new record starts with; every database holding it follows when you save.

In a team, a type's scripts run on your device only in a version you saved or confirmed — a **REVIEW** chip shows when a teammate changed them.
