---
id: 2026-10-11-flight-recorder
date: 2026-10-11
order: 1
title: The flight recorder — who wrote what, on one tape
summary: Every write in the workspace lands on one tape, one track per writer — you, the AI terminal, each agent, MCP clients, scripts, sync. Mod+Alt+Z shows what happened between 07:00 and 08:00, and who it was.
image: assets/shots/changelog/flight-recorder.webp
alt: The board “Nordlicht Handoff” with the flight recorder docked below — six tracks with their counts (You 33, AI terminal 6, the agent Nordlicht-Spiegel 52, the MCP client tessera-desk 4, the script Tagesplan 1, the folder sync 7), the agent's flag “Run 212 · 52 writes in 37 places” bracketed in orange, and the window plate counting 52 writes, 37 places, +212 −40 words, 35 rows (3 new), 1 page, 1 schema.
help: flight-recorder, history
try: recorder
---
**One tape for the whole workspace.** <kbd>Mod+Alt+Z</kbd> (or **Rewind** in the status bar) opens the deck under the page. Each writer has its own track — you, the AI terminal, every agent, each MCP client, scripts, sync, automations — and each track counts its writes in the span you see: 15 minutes to 24 hours, with the last day as a strip on top.

**Runs as flags.** An agent's run, a script run or an MCP session starts with a flag: *Run 212 · 52 writes in 37 places*. Click it and the run becomes the window — the plate beside the tape counts its writes, places, words added and removed, rows (how many new), pages and schemas. A tick opens the page it changed.

**Keys.** On the playhead or a track: <kbd>←</kbd> / <kbd>→</kbd> a minute, <kbd>[</kbd> / <kbd>]</kbd> the window's edges, <kbd>PageUp</kbd> / <kbd>PageDown</kbd> the flags, <kbd>Esc</kbd> closes.

**On this device, without text.** The tape keeps ids, times, counts and fingerprints for 30 days — never page text or values, never synced, backed up or sent. **Workspace settings → Data** shows its size and erases it. More in [Flight recorder](help:flight-recorder).
