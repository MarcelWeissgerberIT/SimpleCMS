---
id: database-commands
title: Database commands
section: databases
order: 11
keywords: commands, database commands, run, sync now, new entry, export csv, open view, run agent, actions, edit commands, sidebar, Befehle, Datenbankbefehle, ausführen
related: databases, buttons, custom-agents, gmail-sync
summary: Every database has a menu of things to run — New entry, Export CSV, Sync now for mails — and you can add your own.
---
Every database has a short list of commands: what you do with it most, one click away.

## Where they are
- **Sidebar:** hover a database and click the **⌘** key next to **+**. On a phone, tap **⋯** — the commands sit on top of that menu.
- **Right-click** a database in the sidebar: the section **Commands** comes first.
- **Database page:** the **⌘** key in the toolbar.
- **⌘K:** type the database's name or the command, e.g. *Mails: Sync now* or *Projects: Export CSV*.

## The defaults
They appear on their own where they fit:
- every database: **New entry**, **From template** (when it has row templates), **Open view**, **Import CSV…**, **Export CSV**, **Copy link**,
- the **Mails** database: **Sync now** with the time of the last sync, **Organise with Claude now** (when that is on), **Mail settings…** — see [Gmail sync](help:gmail-sync),
- a database a custom agent watches or names in its scope: **Run "<agent>" now** — like the agent's own **Run now**,
- the One memory: **Open the memory log**.

A running command shows its LED on the key; the result comes as a short message (*Projects · Export CSV · 8 rows exported*). When something fails, the message has a **Retry** key.

## Your own commands
**Edit commands…** (at the end of the menu) lists every command:
- switch a default off, or back on,
- change the order: drag the grip, or <kbd>Alt+↑</kbd> / <kbd>Alt+↓</kbd>,
- **Add command** — a label, an icon and what it does:
  - **Actions** — the same actions as a [button](help:buttons): add an entry with preset values, edit properties, send a webhook, open a link or page, show a message,
  - **Run agent** — one of your [custom agents](help:custom-agents),
  - **Open view** — the database on one of its views.

*Edit properties* changes the rows you selected in the table — start it with the **⌘** key on the database page.

> A **locked** database keeps its commands as they are: they still run, but nobody changes the list until it is unlocked. In a team workspace the commands are shared like the database; viewers see only commands that don't change anything, and agents follow their own rules (a browser agent runs in its creator's browser).
