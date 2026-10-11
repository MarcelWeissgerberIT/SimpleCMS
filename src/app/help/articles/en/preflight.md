---
id: preflight
title: Preflight
section: start
order: 2
keywords: preflight, vorflug, lamps, lampen, lamp panel, master caution, queue, warteschlange, quittieren, acknowledge, von hand, by hand, angestaubt, stale, superseded, logbook, Bordbuch, start, morning
related: custom-agents, coding-pipeline, outbox, integrations, mcp-servers, sync
summary: A lamp panel on Start shows what waits on you — proposals, gates, questions, refused tokens, slips — counted for 0 tokens; its queue works through it by keyboard.
---
Before a pilot takes off, every warning lamp is checked once. **Preflight** does that for your workspace: on **Start** a panel of lamps shows what waits on you — and only that. Each lamp counts one kind of thing, in your browser, without asking Claude: **counting costs 0 tokens**.

## The lamps
A lamp is on the panel only when it has something to watch here (a coding lamp only with a pipeline, Mail only with the Gmail sync, Worker only with a coding worker):

- **Proposals** — open proposals from [agent](help:custom-agents) runs, the [AI terminal](help:agent), memory, AI-menu results and autofill reviews. Terminal and autofill proposals count only in the tab they belong to.
- **Gate · Plan**, **Coding question**, **Task failed** — your [pipeline](help:coding-pipeline) tasks waiting at a gate, asking, failed or stopped; task versions this device has to confirm.
- **Inbox** — unread reminders, mentions, replies and agent notes of this device.
- **Token refused** — [MCP servers](help:mcp-servers) whose token was refused or whose sign-in ran out.
- **Outbox** — [slips](help:outbox) waiting to be sent by hand.
- **Worker offline**, **Mirror stale**, **Agent missed**, **Sync**, **Mail**, **Cloud** — the things that run for you and stopped.

## Four states
- **Dark** — nothing waits. **Amber** — something waits. **Red** (with a notch ▲, for colour blindness) — something is broken or urgent.
- **Grey, hatched** — the lamp cannot check right now (no folder access in this tab, offline). Grey never counts as "all clear".
- A lamp that turned on since you last looked **flashes** and carries **new**. ↵ on it, or **MASTER CAUTION**, acknowledges it: steady from then on. Acknowledgements are per device and member — your laptop does not acknowledge for your phone.

## Keys on the panel
Only with focus in the panel: arrows move between lamps, **Space** jumps to the next flashing one, **↵** opens its queue. **MASTER CAUTION** (also in the top bar) acknowledges every new lamp at once — with nothing new it unfolds the panel.

In the morning, the first time you open One on a new day, One stays on Start when lamps were lit last time, with the full panel and a short lamp test. Later in the day the panel folds to a **strip** of pips; it unfolds by itself when a lamp turns new. **Settings → Appearance → Preflight**: off, the morning hold, when a new day starts, the lamp test.

## The queue
↵ on a lit lamp opens its **queue** below the panel: one card at a time, the most urgent first, with exactly what the key acts on — the row change, the plan, the version of a task, the slip. Keys (focus in the queue, never in a text field):

- **A** apply · **D** discard · **E** more, where a card has more (the run's report, the worker's log) · **O** open where it lives
- **J / K** next · previous · **Z** undo the last thing done here · **Esc** back to the panel
- **⇧A** applies every clean card of the lamp — but only cards **shown in full** in this tab, as they are now. Cards you have not seen yet (or that changed since) are listed in a sheet first; ↵ there applies what it showed — anything that arrives meanwhile waits for the next ⇧A. Never on **All**.
- **X** discards the stale ones (see below).
- On a phone: swipe a card → to apply, ← to discard.

**BY HAND** marks a card that starts the coding worker, hands text to Claude Code, sends something out, confirms a version, needs a sign-in, text of yours or a look in the editor, or costs tokens. **A** then opens a confirm row; only **↵** or a click on its key confirms — a second A never does, and such a card is never part of ⇧A or a swipe.

## Stale and superseded
A proposal nobody opened for 7 days is **STALE**: the queue groups them at the end with **Discard all** (X), each with Undo.

When a mirror agent runs again, its newer proposal for the same row and fields **supersedes** the older ones you never opened: the card says "replaces 2 older", the old ones count nowhere. A card you opened is never superseded.

## Undo
Z takes back the newest thing done in this tab today, a ⇧A batch at once — through the source's own Undo (the row value back, the terminal change pending again, the memory removed, the inbox item unread again). Some steps have none, and Z says so instead of skipping them: a gate approved or a task run (the worker takes over), a version confirmed, a slip sent by hand, a sign-in. A change someone edited since stays as it is now (only what nobody touched goes back), and Z says that too.

## The logbook
Below the rule card the **logbook** lists today: lamp test, acknowledgements, cards done, Undo. It is kept on this device for 30 days — ids and outcomes only, never text — and goes with the device copy or a reset. The read-out uses it for the pace ("≈ 2 min").

## What is not a lamp
Changes waiting for the team server, approvals of the [MCP bridge](help:mcp-bridge) in Claude Desktop and being offline are shown where they happen, not on the panel. In a team, a server agent's proposals and failures count only for the member who created it; your private pipelines only for you.
