---
id: one-script
title: One Script
section: calculate
order: 4
keywords: script, scripting, code, query, queries, automate, dry run, query builder, mail.send, claude, Skript, Abfrage, Probelauf
related: databases, custom-agents, formulas
summary: Small scripts and queries in One's own safe language — try them as a dry run, build queries by clicking.
---
**Scripts** in the sidebar (or ⌘K → *New script*) holds small programs in One's own language. A script reaches only your workspace — pages, databases, people — plus mail, Claude and the web when you allow it. Nothing else of the browser is reachable.

```
let due = db(@Tasks).where(Status = "Open", Due < today() + 3d)
for t in due {
  t.set(Priority: "High")
}
notify("{due.count} tasks raised")
```

Type `@` and pick a page, database or person: it becomes a chip. The chip keeps pointing at the same page when it is renamed.

## Run, dry run, stop
- <kbd>Mod+Shift+Enter</kbd> — **Dry run**: reads for real, changes nothing, sends nothing, and lists what the script *would* do ("change 2 entries in Tasks, send a mail to …").
- <kbd>Mod+Enter</kbd> — **Run**. Before anything leaves One (mail, Claude, web) or goes to the trash, you see the list once and can untick items. Web requests are off unless you tick them.
- <kbd>Mod+.</kbd> — **Stop**. <kbd>Mod+E</kbd> evaluates the selection (or the current line).
- Every changed page keeps a version first (see [Version history](help:history)), and **Undo run** in the run log puts everything back.
- Endless loops stop on their own: a step and a time budget (60 s; you can give one more).

## The language
- `let x = 1` defines, `x = 2` changes. `#` or `//` starts a comment.
- Values: numbers, texts `"Hi {name}"` (with `{…}` inside), `true` / `false` / `null`, lists `[1, 2]`, records `{to: "a@b.c", subject: "Hi"}`, dates `today()`, `date("2026-10-05")`, durations `3d` `2h` `30m` `1w`.
- `if … { } else { }`, `for t in list { }`, `while … { }`, `fn name(a, b = 1) { return … }`, short functions `x => x.Name`.
- In conditions `=` compares (like SQL): `Status = "Open"`; `!=`, `<`, `>=`, `and`, `or`, `not`, `in`.
- Properties are names: `Due`, `Priority`. A name with spaces goes in backticks:

```
let soon = db(@Tasks).where(`Due date` < today() + 3d).sort(`Due date`)
```

- Calls take named values: `mail.send(to: x, subject: "Data")`.

## The library
- `page(@Page)` / `page("Parent / Page")` → `.title`, `.markdown`, `.text`, `.children`, `.set(…)`, `.append(md)`, `.prepend(md)`, `.replace(md)`, `.open()`; `page.current` is the page a script runs for.
- `db(@Tasks)` → `.where(…)`, `.sort(Due desc)`, `.limit(n)`, `.select(Name, Status)`, `.count`, `.sum(Budget)`, `.avg`, `.min`, `.max`, `.group(Status)`, `.first`, `.rows`, `.add("Title", Status: "Open")`, `.schema`. Entries are pages with their properties: `t.Status`, `t.set(Status: "Done")`.
- Values follow the database: options by name, dates, people by name, relations by title.
- `create.page(title: …, parent: @Page, markdown: …)`, `trash(row)`.
- Text, lists, numbers, dates: `upper`, `split`, `join`, `replace`, `contains`, `len`, `round`, `format(date, "dd.MM.yyyy")`, `days_between` … — the **Reference** next to a script lists them all.
- Asking: `modal(text, buttons: ["OK"])`, `confirm(text)`, `ask(text, default: "")`, `choose(text, options)`, `notify(text)`, `print(…)`.
- Effects: `mail.send(to:, subject:, body:, cc:)` — a ready draft in your mail program (or Gmail when connected); `claude(prompt, context)` — your own Claude key; `http.post(url, data)` — only when you allow it.

## Queries
A script of kind **Query** shows its result live under the editor while you type — with the count, the time and "0 results" when nothing matches. Queries only read: a write or an effect is refused.

The **Query builder** next to it builds `db(@X).where(…).sort(…).limit(…).select(…)` by clicking: conditions per property (the operators fit the type; options, people and date presets like *today + 3 days*), *all* / *any* and one level of groups, sort, limit and fields. It writes the code, and editing the code updates it. Code it cannot show stays exactly as written — **Edit as text**.

> In a team workspace scripts are shared. A version someone else changed runs on your device only after you looked at it and confirmed it. Runs are kept per device.
