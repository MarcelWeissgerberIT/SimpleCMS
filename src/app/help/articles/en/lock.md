---
id: lock
title: Lock pages & databases
section: writing
order: 11
keywords: lock, read only, protect, freeze, unlock, sperren, schreibgeschützt, entsperren
related: history, databases, properties
summary: Lock a page against accidental edits, or a database against schema changes.
---
## Lock a page
Page options **•••** (top right) → **Lock page**, or ⌘K → *Lock page*. The page becomes read-only; the top bar shows **Locked**. Click it — or choose **Unlock page** — to edit again.

## Lock a database
In the database toolbar, **•••** → **Lock database**.
- Properties and views are locked: no new properties, no changes to types, views, filters or sorts that are saved.
- Rows stay editable — people can still add and change entries.
- Filters and sorts you set on a locked database apply to your tab only and are not saved (**Reset** clears them).

**Unlock database** in the same menu lifts it.
