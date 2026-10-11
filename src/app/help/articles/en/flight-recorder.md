---
id: flight-recorder
title: Flight recorder
section: writing
order: 14
keywords: flight recorder, rewind, tape, deck, track, tracks, writer, writers, who changed, who did that, what happened, timeline, audit, run, flag, window, loupe, agent, mcp, script, sync, undo, writes, places, Flugschreiber, Zurückspulen, Rückspulen, Band, Spur, Spuren, Schreiber, wer war das, Vorgänge, Stellen, Lauf, Fenster, Lupe
related: history, custom-agents, mcp-bridge, privacy, lock
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

Orange marks the playhead and the selected window — the rest of the deck is ink, apart from the REC lamp.

## Keys
With the playhead, a track or a flag focused:
- <kbd>←</kbd> / <kbd>→</kbd> — one minute back / forward, with <kbd>Shift</kbd> ten seconds
- <kbd>[</kbd> / <kbd>]</kbd> — start / end of the window at the playhead, on the focused track (German Windows: <kbd>AltGr+8</kbd> / <kbd>AltGr+9</kbd>, Mac: <kbd>⌥5</kbd> / <kbd>⌥6</kbd>)
- <kbd>↑</kbd> / <kbd>↓</kbd> — the track above / below
- <kbd>PageUp</kbd> / <kbd>PageDown</kbd> — the previous / next flag on the track
- <kbd>Home</kbd> / <kbd>End</kbd> — the start of the span / now
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

> The deck only reads. It never changes the workspace — to go back, use [version history](help:history) or the review of an agent's run.
