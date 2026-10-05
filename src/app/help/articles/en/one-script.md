---
id: one-script
title: One Script
section: calculate
order: 4
keywords: script, scripting, code, query, queries, automate, dry run, query builder, mail.send, claude, run script, button, database command, automation, gmail, mcp, one_run_query, one_run_script, ai terminal, ask claude, Skript, Abfrage, Probelauf
related: databases, database-commands, buttons, automations, gmail-sync, mcp-bridge, agent, custom-agents, formulas
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
- Effects: `mail.send(to:, subject:, body:, cc:)` — sent through Gmail when it is connected, else a ready draft in your mail program (see *Mail through Gmail*); `claude(prompt, context)` — your own Claude key; `http.post(url, data)` — only when you allow it.

## Queries
A script of kind **Query** shows its result live under the editor while you type — with the count, the time and "0 results" when nothing matches. Queries only read: a write or an effect is refused.

The **Query builder** next to it builds `db(@X).where(…).sort(…).limit(…).select(…)` by clicking: conditions per property (the operators fit the type; options, people and date presets like *today + 3 days*), *all* / *any* and one level of groups, sort, limit and fields. It writes the code, and editing the code updates it. Code it cannot show stays exactly as written — **Edit as text**.

## Run a script from anywhere
- **Database command** — *Edit commands… → Add command → Run script* on a database (see [Database commands](help:database-commands)). Started from the database page's Commands key with rows selected, it runs once per row — `page.current` is that row; otherwise once for the database page.
- **Button** — the button action *Run a script*, or type `/script`: a button bound to a script, run for the page it sits on (see [Buttons](help:buttons)).
- **Automation** — the action *Run script* runs it for the row that changed (see [Automations](help:automations)). While it runs, its own changes start no automation again.
- **⌘K** — type *Run script: <name>*: it runs for the page that is open.

Every one of these is a normal run: mail, Claude, web requests and the trash are listed and asked first; the toast after the run has **Undo**.

## Mail through Gmail
When Gmail is connected on this device (Settings → Mail, see [Gmail sync](help:gmail-sync)), `mail.send` **sends** from that account — the list before the run says *via Gmail · you@…*. The first time, Google asks once more: for permission to *send* mail (reading stays as it was). The sign-in lives in this tab's memory only, never in storage. Without Gmail, a ready draft opens in your mail program instead; nothing is sent by One.

## Ask Claude
On top of the query builder (queries) and the reference (scripts): describe what you want — *open tasks due this week, soonest first* — and Claude drafts the code. Claude gets your request, the code and the names and properties of your databases, never page content. The draft is checked before you see it (a query is also tried, read-only, with its row count); **Use this** puts it into the editor (with Undo), nothing runs on its own.

## With Claude and agents
- **AI terminal** (⌘J): Claude answers questions across databases with a read-only query (`run_query`) and drafts scripts for you (`write_script`) — a drafted script lands in the review list; *Apply* saves it under Scripts, it never runs by itself.
- **Custom agents** get `run_query` too — inside their scope.
- **One MCP** (Claude Desktop, Claude Code, see [MCP bridge](help:mcp-bridge)): `one_run_query` answers a query; `one_run_script` runs one of your saved scripts — One first shows a dry run of what it would change and send on the approval card, and it runs only after you approve it, also in *Apply directly*. *Read only* refuses it.

> In a team workspace scripts are shared. A version someone else changed runs on your device only after you looked at it and confirmed it. Runs are kept per device.
