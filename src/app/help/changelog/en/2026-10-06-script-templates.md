---
id: 2026-10-06-script-templates
date: 2026-10-06
order: 8
title: One Script — autocomplete that knows your databases, and 20 templates
summary: The script editor now suggests like an IDE — properties, options, members by type, snippets — and a gallery of ready-to-run templates adapts to your workspace.
image: assets/shots/changelog/script-templates.webp
alt: The template gallery with its categories and cards, next to the script editor suggesting the options of a Status property after "Status ="
help: one-script
---
**Templates** — *From template* on the Scripts page (or ⌘K → *New script from template…*) opens a gallery of 20 scripts: overdue entries → a report page, due this week by day, project progress as a table and chart, mails that need a reply → tasks, contacts to follow up, a weekly review, duplicate titles, a weekly update mail drafted by Claude and more. Each one picks a fitting database of your workspace and writes its real names; the card says what it uses — or what it needs.

**Autocomplete** — suggestions while you type, after `.` and `@`, or with <kbd>Ctrl+Space</kbd>:

- members that fit the value: a query's methods, a row's properties first, a date's parts — each with its signature and a line about it;
- inside `.where(` or `.set(` the database's properties, after `Status = ` its options;
- snippets like `for`, `if` or `query` with places to fill — <kbd>Tab</kbd> jumps from one to the next.

<kbd>F1</kbd> explains the name at the caret. New in the library: `md_table` and `md_chart` write tables and real chart blocks into pages. See [One Script](help:one-script).
