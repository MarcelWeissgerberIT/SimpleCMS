---
id: flight-recorder
title: Flight recorder
section: writing
order: 14
keywords: flight recorder, eject, ejecting, take back, revert a run, undo an agent run, before the eject, rewind, tape, deck, track, tracks, writer, writers, who changed, who did that, what happened, timeline, audit, run, flag, window, loupe, agent, mcp, script, sync, undo, writes, places, read window, incident report, held, changed since, word by word, Flugschreiber, Fenster lesen, Vorfallbericht, gehalten, Zurückspulen, Rückspulen, Band, Spur, Spuren, Schreiber, wer war das, Vorgänge, Stellen, Lauf, Fenster, Lupe
related: history, custom-agents, mcp-bridge, privacy, lock, preflight, outbox
summary: Every write in the workspace on one tape, one track per writer — you, the AI terminal, each agent, MCP clients, scripts, sync. See what happened between 07:00 and 08:00, and who it was.
---
Many hands write in a workspace: you, the [AI terminal](help:agent), [agents](help:custom-agents), an MCP client through the [bridge](help:mcp-bridge), scripts, the folder or GitHub sync, automations. The [version history](help:history) answers for one page; the flight recorder answers for the whole workspace: **what changed between 07:00 and 08:00, and who did it?**

## Opening the deck
- <kbd>Mod+Alt+Z</kbd> — anywhere, also while you write in a page. On a German keyboard it is the key labelled Z; <kbd>AltGr</kbd>+Z never opens it.
- **Rewind** in the status bar, ⌘K *Rewind*, **Flight recorder** in the page menu **•••** and in the workspace menu of the sidebar.
- **Workspace settings → Data → Open the tape.**

The deck docks under the page; the page stays usable, and a tick you click opens its page above the deck. <kbd>Esc</kbd> or ✕ closes it. The AI terminal and the deck share the dock: opening one closes the other — a task in the terminal keeps running.

## Reading the tape
- **Tracks.** One per writer: **You**, **Undo** (an undo, a restored version), **AI terminal**, **AI menu**, each agent by name, each MCP client, scripts, sync, automations, import, templates. Each track counts its writes in the visible span. The filter key (*6/6*) hides the tracks you do not need; One remembers that on this device.
- **Writes and places.** A *write* is one change by one writer — a value, a piece of text, a property. Typing counts as one write per page every 30 seconds. A *place* is what changed: a row, a page, a database's properties, a view. A run touches many places with many writes: *Run 212 · 52 writes in 37 places*.
- **Flags** mark runs (an agent's run, a script run, an MCP session) at their start. Click a flag and its run becomes the **window**: its edges rounded out to five minutes, the plate on the right counts it — writes, places, words added and removed, rows (how many new), pages, schemas, views.
- **Ticks** are single writes. A tick with one place opens that page (a database's properties or view open the database); a tick with several lists them.
- **A window by hand.** Drag along a track — or set its edges at the playhead with **Start here** / **End here** on the plate (the keys <kbd>[</kbd> / <kbd>]</kbd>), on the focused track. On a phone, where a drag scrolls the tape, tap the track first, then move the playhead and set the edges.
- **Hatched across the tracks, *Recording interrupted*:** a tab closed before it had written what it recorded — that stretch is unknown, not quiet.
- **Span.** **15 min · 75 min · 6 h · 24 h**. The strip on top shows the last 24 hours in quarter hours — click it to move the tape there. With a window on the tape, **Loupe** gives it up to six times the room (not at 15 min, which is wide enough).
- **Playhead.** The orange line; the counter shows its time. The keys beside the counter move it to the previous run, a minute back, a minute forward, and **Now** back to the present.

Orange marks the playhead, the selected window, the places held (changed since) and **Eject** — the rest of the deck is ink, apart from the REC lamp.

## Reading a window
With a window on the tape, press <kbd>↵</kbd> — on the playhead, a track or a run's flag (a flag brackets its run first) — or **Read window** on the plate. A tick with several places has **Read window** too: that one write, bracketed.

- **What changed, grouped.** Schema, views, pages, rows, new rows (and what went to the trash or moved). Each group shows three places and **+ n more**; <kbd>↑</kbd> / <kbd>↓</kbd> walk the list, <kbd>Home</kbd> / <kbd>End</kbd> jump, <kbd>↵</kbd> on **+ n more** opens the group. The picked place shows on the right: its writes and when, the state it is read from (*Before run 212 · 07:31:21*), who changed it since.
- **Values and text, word by word.** A row's properties before → after, the page text word by word — in ink, like a printed proof. Titles are read live, the values from the versions One kept on this device.
- **Held: changed since.** A place someone changed after the window — you, a colleague, another agent, a sync — is *held*: a diamond on the tape and an orange mark in the list (*2 rows changed since (you) — they are held*). What another writer did in the middle of the window is marked *contains changes by …* on its block or value and is never counted as the window's.
- **Partly.** A window that cuts a writer's stretch (it began before the window or went on after it) reads *Partly*; the key **Extend the bracket to …** (or **Bracket the whole run**) takes in all of it.
- **Possibly incomplete.** A tab closed before it wrote what it recorded during the window: what it did is unknown.
- **Only after the fact.** *State after only approximate*: the place changed again before One had written down the window's result.

On a phone the dialog is a sheet; tap a place for its values and text on a second sheet, **‹ Plan** goes back. <kbd>Esc</kbd> closes the dialog first, then the deck. Reading never changes the workspace.

## Incident report
**Report** — on the plate or in the dialog's footer — downloads a Markdown file (`incident-<date>-<time>-<writer>.md`): the window, every writer with writes in it, what changed (schema changes by name, pages with their word counts, rows with the names of the properties that changed) and notes (held, partly, incomplete). It holds titles, property and option names, writer labels, counts and times — **never a value, never a line of text**. It is made when you press the key and stored nowhere; what you do with the file is up to you.

## Ejecting a window
**Eject** on the plate takes a window's writes back — a whole agent run, a terminal task, an MCP session, a script run, or a stretch you bracketed — and leaves everything else as it is. On a computer the key lies under a hatched cover: lift it first (click or <kbd>↵</kbd> on the cover); another window closes it again. The key counts what would go back: **Eject · 35 / 37**.

The key never writes. It opens the dialog — *Eject 52 writes by Nordlicht mirror?* — with the plan:
- **What goes back**, grouped like the reading: the schema (*Option "Ready" comes back — Board gets its column back*), views, pages, rows. A row goes back **whole** — all of its values and its text, or nothing; a page goes back **block by block**, only the blocks the window wrote.
- **New things go to the trash** — rows and pages the window created are moved to the trash, never deleted.
- **Held: changed since.** A place someone changed after the window (you, a colleague, another agent, a sync) stays as it is, with the reason in words: *Status is no longer what Nordlicht mirror left: You set "In progress". Stays as it is.* Its card on a board and its row in a table carry a **Held** tag afterwards.
- **No exact earlier state.** A place whose state before the window this device does not know exactly stays — never a guess.
- **Never ejected:** the order of the views, database commands, templates, automations, the coding pipeline, record types, a property of a record type, an option of a shared list — and **memories**, which you edit in their database.

**Revert 35 places** (or <kbd>↵</kbd>, a moment after the dialog opened) writes it: first One saves every page it will change as a version, **Before the eject** ([version history](help:history)); then it checks the plan once more — if anything changed since the dialog opened, nothing is written and the dialog shows the new plan, to confirm again; then everything goes back in **one step**.

### Undo
The message after an eject — *35 places by Nordlicht mirror reverted · 2 held* — has **Undo** (<kbd>Ctrl+Z</kbd> / <kbd>⌘Z</kbd> while it shows, unless you are typing in a field or a page) and **Show held**. The plate keeps what happened — places, what went back, the trash, held, the version — with **Undo the eject**, also after the deck was closed and after a reload. The Undo puts back exactly what the eject changed, in one step; a place changed again since stays (*kept*). An eject is never ejected itself — its own writes are on the **Undo** track, and **Undo the eject** takes it back.

### What else the eject settles
- **[Agent runs](help:custom-agents).** The run's proposals that went back read **Ejected** in its review, the held ones **Held · changed since** (still applied); proposals still waiting are discarded — except ones you opened in [Preflight](help:preflight). The Undo brings them back.
- **AI terminal, MCP, scripts.** An ejected terminal change is discarded and its Undo writes nothing more; an MCP call or a script run reads as undone. The Undo gives them back.
- **[Outbox](help:outbox).** A row marked as sent is held — a send is never undone. Unsent slips of discarded proposals are withdrawn and stay withdrawn after an Undo; other slips on rows that go back show **CHANGED**.
- **Coding tasks.** Fields that move a task (Stage, Then, Repo, Branch) are never ejected. A task that gets an agent's text back waits for **Confirm** before the worker takes it.
- **Triggers.** Automations, row-triggered agents and autofill do not react to an eject or its Undo.
- **Interrupted.** A tab closed in the middle of an eject is finished the next time One opens.

Ejecting works in local workspaces; team workspaces get it later — reading works there.

## Keys
With the playhead, a track or a flag focused:
- <kbd>←</kbd> / <kbd>→</kbd> — one minute back / forward, with <kbd>Shift</kbd> ten seconds
- <kbd>[</kbd> / <kbd>]</kbd> — start / end of the window at the playhead, on the focused track (German Windows: <kbd>AltGr+8</kbd> / <kbd>AltGr+9</kbd>, Mac: <kbd>⌥5</kbd> / <kbd>⌥6</kbd>)
- <kbd>↑</kbd> / <kbd>↓</kbd> — the track above / below
- <kbd>PageUp</kbd> / <kbd>PageDown</kbd> — the previous / next flag on the track
- <kbd>Home</kbd> / <kbd>End</kbd> — the start of the span / now
- <kbd>↵</kbd> — read the window (on a flag: its run)
- <kbd>Esc</kbd> — close; the playhead goes back to now

The grip on the deck's top edge sets its height (drag, or <kbd>↑</kbd> / <kbd>↓</kbd> on it).

## What is stored, and where
- **On this device only.** The tape lives in this browser (IndexedDB `one-recorder`), 30 days back. It is never synced, never in backups, exports or share links, and never sent to Claude.
- **No text, no values.** The tape holds ids, kinds of change, times, counts and fingerprints made with a key this browser keeps and cannot export. Page text and property values are not readable from it; outside this browser profile it is useless. Only names of properties, options and views appear, where a database's properties changed.
- **Earlier states.** Before a writer starts on a place, One keeps that place as it was — like a version, on this device, 30 days. Deleting a page forever drops them too.
- **Room.** All workspaces on this device share one budget (at most 250 MB). The workspace's own save always wins: short of room, the tape gives up its oldest days first, and pauses when there is nothing left to give. **Workspace settings → Data** shows the tape's days, writes and size, and **Erase the tape** forgets this workspace's tape on this device — the pages and their history stay.
- **Reset workspace** and removing a team workspace's copy from this browser erase its tape too.

## Team workspaces
A device knows only what it saw: your own writes, the agents and terminal tasks that ran in this browser, and a **Team** track for changes that arrived from your colleagues through the server. Another device has its own tape.

> Reading never changes the workspace; only **Eject** does — after its dialog, with a version first and one Undo.
