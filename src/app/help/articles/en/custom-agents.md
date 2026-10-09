---
id: custom-agents
title: Custom agents
section: ai
order: 4
keywords: custom agents, agents, schedule, recurring, automate, trigger, recipe, report, server agent, webhook, budget, MCP tools, read-only tools, state, inbox note, mirror, sync, key, upsert, only by hand, integration, Eigene Agenten, Agenten, Zeitplan, spiegeln
related: agent, integrations, automations, mcp-servers, properties, mentions-dates, gmail-sync
summary: Saved AI helpers for recurring work — each with a job, a trigger and limits. They run on their own and report back.
---
**Agents** in the sidebar lists your custom agents. **New agent** starts from a recipe — *Daily mail triage*, *Weekly report from projects*, *Summarise new form answers*, *Check pages against your knowledge base* — or **Blank**. An active [integration](help:integrations) adds its own recipes, named by the integration, such as a mirror of another tool's list. Nothing runs until you save.

## What an agent has
- **Job** — a **Name** and **Instructions** in plain words (**Improve with Claude** polishes them). The field numbers its lines and underlines the tools the agent can use (One’s and its MCP servers’); placeholders in capitals like `[HOW TO LIST THE ITEMS]` are marked and counted — **Next placeholder** jumps to one, and **Run now** asks first while any is open.
- **Trigger** — **Manual**, **Schedule** (hourly, daily, weekdays, weekly, monthly, at a time and time zone), **New row** in a database (form answers and synced mails included), **Row changed**, or **Webhook** (server agents only).
- **Access** — **May use**: everything, or chosen pages and databases. **Changes**: **Read only**, **Proposals for review** or **Apply directly** (written as “Agent · name”, undoable in the version history). **MCP servers** it may call, e.g. your knowledge base.
- **Report** — an optional **Report page** each run writes to (added at the end, or replacing it). A page or database in the trash (or below a page there — that page is named) or deleted for good is never saved under **May use** or as the report page — take it out or restore it first.
- **Engine** — **Runs where**, **Model**, **Effort** and a **Budget per run** (typed with your language's decimal mark, or a dot): the run stops when its estimated cost goes over.

## Tools, state and notes
These come with an active [integration](help:integrations) that unlocks them — a profile that matches one of your MCP servers. Without one they are not offered; a tool list an agent already has stays applied.
- **MCP tools** — under each MCP server you tick, the tools of its last connection test: untick what the agent must not use. **Read-only tools** keeps only the ones that look like reads (get, list, search, query, read, fetch, find …); **All** allows every tool, also ones the server adds later. A server that was never tested says **Test the connection first** (**Settings → Claude AI → MCP servers**).
- **Last run** — every run knows when the agent's last successful run was, so a recurring job can look at what changed since then.
- **Saved state** — an agent can keep a small note of its own between runs (where it stopped, what it has seen). It is saved only when a run finishes without an error. Browser agents keep it on this device — the agent page shows it, and **Clear** makes the next run start from scratch; server agents keep it on the team server, encrypted. A browser run whose changes wait for review (or that applied changes) saves it too — discarding every change (undone first, if it applied them) puts back the state from before that run, unless a later run has saved one since. Runs discarded in any order end alike: at the state of the newest run whose work stays, or the one from before them all.
- **Notes for you** — a browser agent can leave you a short note in the **Inbox** (“New comment on #8215”, “3 items became ready”), linked to the page it is about. Notes arrive only when the run finishes, at most ten per run; browser notifications only if you switched them on in the inbox. Server agents put their news into the report.
- A scheduled agent that **applies** changes shows a short message (“Agent · name: 3 changes”) with **Open**.

## Runs
**Run now** starts one at once. Every run is listed under **Runs** with its report, its steps and its cost; proposals wait there for **Review**, and the sidebar shows how many are waiting. **Apply** on one proposal shows the result in its own row, with **Undo** right there; **Apply all** says so in a message. A message says when an agent has new proposals, finished or failed — except while its own page is open, which shows the run already.

When a page the agent works with is in the trash or deleted for good — a page or database under **May use**, the database its rows start it from, its report page — its page names each one, with **Restore** for one in the trash. A browser run does not start while nothing under **May use** can be used or its report page is gone: it is listed as an error that says why.

Messages about runs never cover a dialog: one that comes while a dialog is open (an agent's editor, the settings) waits and shows when the last dialog closes — one older than two minutes by then is dropped (the run lists everything anyway).

## Browser or server
- **Browser** agents run in One while a tab is open — with your Claude key and your MCP servers. A scheduled run missed while One was closed happens once, the next time it opens.
- **Server** agents (team workspaces) run on the team server around the clock, with a Claude key and MCP servers an admin sets up under **Settings → Agents · MCP**.

## Keeping a database in step
An agent can mirror items from another system (through an MCP server) into a database. Three things make that safe — the switches and the tool are unlocked by an active [integration](help:integrations); keys and *Only by hand* already set always hold:
- **Key** — a property that identifies a row, like a ticket number (in the property menu, see [Key and Only by hand](help:properties)). Its values are unique: a value another row holds is refused, for agents and for you.
- **Upsert** — the agent finds each item by the key and adds a new row or changes only the values that differ: up to 50 rows in one step, each its own proposal (*created*, *updated*, *unchanged* or *refused* with the reason).
- **Only by hand** — properties set to it are never written by an agent, so your own notes next to the mirrored data stay yours.

## Mirror a list into a database
An [integration](help:integrations) brings this recipe — its database, views and agent are its configuration; without its own values it is the built-in mirror described here. Pick it under **New agent** (it carries the integration's name), then:
1. **Source** — the MCP servers of this device that match the integration (the first is picked). Test it once under **Settings → Claude AI → MCP servers**: the agent then starts with that server's reading tools only (or the tools the recipe names).
2. **Name** and **Where** — the database's name and the page it goes below (in a team workspace: your Private section).
3. **Create database and agent** makes a database with the item's fields (Key, Link, Source status, Source priority, Owner, Tags, Changed at, Comments, Last comment, **New comment**, **Waiting on me**, **Clarity**, Why, Gone from source) and yours, set to *Only by hand*: **My status**, **My priority**, **Next step**, **Due**. Six views: **Board by Clarity** (waiting on you in red, new comments in orange), **New comments**, **Ready to work**, **My week**, **As in the source** and **All** — and a report page next to it. **Undo** in the editor’s note moves both to the trash (a toast brings them back); when you already changed the agent, it asks first. Close the editor without saving and it asks: keep the database and the report page, or move both to the trash; leave the page with the editor open and a message says both stay, with Undo — the next agent dialog you open takes such a message away, so its Undo never catches a click meant for the dialog. A database of the same name is never made twice — the setup says so and offers to set the agent up for the one that is there: with the report page a setup on this device made for it before (if you kept it and no saved agent uses it), else with a new one next to it. When an agent mirrors into it already — the one this recipe set up for it, even with its server switched off or renamed, or with its scope set to everything — the setup opens that agent instead; when that database is in the trash, the setup says so and offers **Restore**. The plate at the bottom shows the names exactly as the offered button makes them. Titles the setup makes never repeat another page or an agent that is there (“Weekly report (Bugs)”, then “(2)”); a report page may carry its database's name. A source switched off in Settings while the setup is open drops out — the one you picked stays, marked, until you pick another. Taking back only ever touches what the setup itself made — never a page a saved agent uses. In a team workspace only a private database is used, and only your own agents count.

The agent opens in the editor — built in: every weekday at 07:30, **Proposals for review**, a budget of $1.00 per run. Replace the four parts in **[SQUARE BRACKETS]** in its instructions — how to list the items, how to read one with its comments, who you are in the tool, and what *Clear* means for you; **To replace** above the text selects each one. A switched-on agent cannot be saved while one is left.

Each run reads only what changed since the last one (its saved state holds the comment count per item), updates the rows by key, marks **New comment** and **Waiting on me**, judges the **Clarity**, checks **Gone from source** for items the tool no longer lists, and leaves you notes in the [inbox](help:mentions-dates) — *“New comment on #8215”*, *“3 items became ready”*. Once the first runs look right, switch **Changes** to **Apply directly**.
