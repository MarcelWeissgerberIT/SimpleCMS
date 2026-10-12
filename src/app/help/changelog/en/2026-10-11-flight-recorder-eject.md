---
id: 2026-10-11-flight-recorder-eject
date: 2026-10-11
order: 2
title: Eject — take a run back, keep what changed since
summary: The flight recorder takes a window's writes back — an agent run, a terminal task, an MCP session, a script — in one step, after a dialog that shows what goes back and what is held. A version first, one Undo.
image: assets/shots/changelog/flight-recorder-eject.webp
alt: The board “Nordlicht Handoff” after the eject — the column “Ready” back (BACK · 08:05), NL-1408 tagged Held · You 07:44, the message “35 places by Agent · Nordlicht-Spiegel reverted · 2 held” with Undo, and the deck's plate “Ejected 08:05” listing places, what went back, the trash, held and the version.
help: flight-recorder, history, custom-agents
try: recorder
---
**Eject.** Bracket a run on the tape, lift the hatched cover on the plate and press **Eject · 35 / 37**. The dialog shows the plan: schema parts by name (*Option "Ready" comes back — Board gets its column back*), pages block by block, rows whole, new rows to the trash.

**Held, with the reason.** A place someone changed after the run stays as it is: *Status is no longer what Nordlicht-Spiegel left: You set "In progress".* Afterwards its card carries a **Held** tag.

**Safe by construction.** One saves a version **Before the eject** of every page it changes, checks the plan once more just before writing (anything changed → it shows the new plan), then writes it in one step. The run's review reads *Ejected*, its waiting proposals are discarded, and automations do not fire on it.

**One Undo.** The message has **Undo** — <kbd>Mod+Z</kbd> while it shows — and the plate keeps **Undo the eject**, also after a reload. Local workspaces for now. More in [Flight recorder](help:flight-recorder).
