---
id: 2026-10-05-one-script
date: 2026-10-05
order: 2
title: One Script — small scripts and live queries
summary: A small, safe script language that only reaches your workspace — with dry runs, a live query tester and a query builder.
image: assets/shots/changelog/one-script.webp
alt: A query in the script editor with the Projects database as a chip, the query builder with its conditions on the right and the live result table below
help: one-script, databases
---
**Scripts** in the sidebar holds small programs in One's own language — `let`, `if`, `for`, `fn`, texts with `{…}`, dates and durations like `today() + 3d`. They reach only your pages, databases and people; mail, Claude and the web only when you allow it.

- Type `@` to pick a page or database: it becomes a chip that survives renames.
- <kbd>Mod+Shift+Enter</kbd> is a **dry run**: it reads for real, changes nothing and lists what the script would do. <kbd>Mod+Enter</kbd> runs it — anything that leaves One is listed once first, every changed page keeps a version, and **Undo run** puts it all back.
- A **query** shows its result live as you type — count, time, and a clear “0 results”. The **query builder** next to it writes the code by clicking (conditions, sort, limit, fields) and follows when you edit the code.

`mail.send` opens a ready draft in your mail program; `claude()` uses your own key. See [One Script](help:one-script).
