---
id: history
title: Version history
section: writing
order: 11
keywords: history, versions, restore, undo, snapshot, backup, previous version, diff, changes, properties, database entry, Verlauf, Versionen, wiederherstellen, Eigenschaften
related: lock, export, ai-menu
summary: One keeps earlier versions of every page. Scrub back in time and restore.
---
Open a page and click **Version history** (the clock in the top bar), or ⌘K → *Version history*.

1. Drag the tape — or press <kbd>←</kbd> / <kbd>→</kbd> — to travel through the versions.
2. **Changes** shows what changed since that version: a changed paragraph word by word — removed words struck through on red, new words on orange — added and removed blocks whole, unchanged blocks folded (*12 unchanged blocks — show*). **Version** shows the page as it was.
3. **Restore this version** brings it back. The state before the restore is kept as a version too, so you can go back again.

## Database entries
A version of a database entry also keeps its **title, icon and property values** — Status, dates, people, options, numbers, checkboxes, relations. **Changes** lists the ones that differ above the text, in a **Properties** block: *Status: In progress → Done* with the old value struck through and the new one marked, a multi-select as removed and added chips. Restoring brings the values back with the content.

- A property deleted since, or turned into another type, can't take its old value: it is listed as *not restored*, the others go back.
- Computed properties (formulas, rollups, created / edited time and by) are never part of a version; an ID stays as it is.
- Columns and views of a database are not in the history — only the entries' values. A change of values starts versions like typing does; so does a bulk edit, at most one version per entry every few minutes.

## When versions are saved
- **Start** — the state before you begin editing in a session,
- **Auto** — while you edit, at most every few minutes (**Settings → Data → Version snapshots**),
- **AI** — right before Claude, an agent, an automation or an MCP client changes the page or the entry's values,
- **Manual** — when you click **Save version**.

> Versions are stored on this device with the page. For a copy elsewhere, export a backup.
