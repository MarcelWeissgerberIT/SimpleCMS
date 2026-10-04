---
id: subitems
title: Sub-items & dependencies
section: databases
order: 6
keywords: sub-items, subtasks, nesting, parent, children, dependencies, blocked by, blocking, gantt, timeline, arrow, Unterelemente, Abhängigkeiten, blockiert
related: views, properties, filter-sort-group
summary: Nest rows under a parent, and let rows wait for each other on the timeline.
---
Both live in the database toolbar under **•••**.

## Sub-items
Switch on **Rows can have sub-items**. One adds the pair **Parent item** ↔ **Sub-items**. Tables and lists then nest rows under their parent; expand them with the arrow, or **Add sub-item**. **Show sub-items** chooses *Nested*, *Flat* or *Parents only*. Boards, galleries and calendars show every row as its own card with a sub-item count.

## Dependencies
Switch on **Rows can block other rows**. One adds **Blocked by** ↔ **Blocking**.

On a **Timeline**, drag the dot at the end of a bar onto another bar: that row now waits for this one, and an arrow shows it. Click an arrow and press <kbd>Delete</kbd> to remove it.

**When dates conflict:**
- **Shift dependents** — moving a blocker past its dependents pushes them later by the overlap; their durations stay.
- **Only warn** — dates stay; the arrows of overlapping pairs turn orange.

Switching either off asks whether to keep both properties as ordinary relations or delete them.
