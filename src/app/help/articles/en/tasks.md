---
id: tasks
title: Tasks
section: writing
order: 6
keywords: task, tasks, aufgabe, to-do, todo, action item, due, due date, deadline, assign, assignee, owner, blocked, blocker, depends, waiting, related, [!], Mod+Enter, Aufgabe, Aufgaben, fällig, zuweisen, blockiert, abhängig, wartet
related: mentions-dates, blocks, templates, keyboard-shortcuts, team-cloud
summary: A task is a block with a status, a due date, people and what it waits for — right in the text.
---
**A task, not a checkbox.** Type `/task` (or `/aufgabe`) — or `[!]` and a space at the start of a line. The first line is the title; notes go below it, <kbd>Shift+Enter</kbd> jumps there. A to-do list in the notes counts as steps (**2/4**).

## Status
- Click the key on the left: the task is **done** — click again to reopen it. <kbd>Mod+Enter</kbd> does the same while the caret is in the task (a to-do in its notes is ticked first).
- **In progress**: <kbd>Alt</kbd>-click the key, pick it from the small arrow beside the key, or press <kbd>Mod+Alt+Enter</kbd>.
- <kbd>Enter</kbd> at the end of a title starts the next task, at its start it puts a new one before it. <kbd>Enter</kbd> on an empty title with nothing set turns it back into a line; <kbd>Backspace</kbd> at the start of an empty title unwraps the task.

## Due date, people, links
Use the chips under the title — or <kbd>Alt+Enter</kbd> for the task's menu: **Due date…**, **Assign…**, **Blocked by…**, **Related…**, **Blocks…**. Empty fields show as dashed keys (**+ DATE**, **+ PERSON**, **+ DEPENDS ON**, **+ NOTE**) while the caret is in the task. Typing `@` in a title offers **Assign: …** and **Due: …** above the usual mentions.

In a picker, <kbd>Esc</kbd> leaves everything as it was; **Done** (or <kbd>Enter</kbd>) writes it.

## Blocked
A task **waits** while anything it is blocked by is still open — worked out live, never stored. It shows **BLOCKED**, one chip per blocker with its own lamp, and **WAITING FOR 2 OF 3**. You can still mark it done: One asks once. Finishing a blocker tells you who can start now (**Unblocked: …** with **Open**); reopening it blocks them again.

A link that would close a loop is refused. A loop that arrives anyway (two people linking at the same moment) shows **LOOP** and never blocks. **BLOCKS n** and **n RELATED** list the other side, with **Remove link** and Undo.

## Reminders
A due date can remind you like a [date mention](help:mentions-dates): choose **Remind** in the due date picker. A task that is done reminds nobody. In a team workspace a task with people rings only for them; with nobody assigned it rings for every member — the picker says who. Tasks with a due date also show on the **Agenda**.

## Copies and moves
- Copying a task (paste, duplicate, a copied page or template) makes a **new** task; cutting and pasting **moves** it — links to it keep working.
- **Use template** starts its tasks fresh: open, without a date or reminder (people and links stay).
- The same task twice (an old copy) shows **DUPLICATE** with a **NEW ID** key — one click and it is its own task.
- Button templates hold no tasks: a task pasted into one is kept as its text.

## Task or database?
Tasks live in the text where the work is discussed — a launch plan, meeting notes, a brief. A [database](help:databases) is for lists you sort, filter and view as a board or a calendar. To-do lists stay the light checklist — and the steps inside a task.

## Files and sharing
Markdown exports and synced files write a task as `> [!TODO] Title` plus a line with its fields; a `[!TODO]` typed into a file is read back as a quote. Share links and the published site show tasks frozen: names, no ids. In a team workspace the last change wins per field — two people assigning at the same moment may keep only one change; a tab that is out of date can only read until it reloads.
