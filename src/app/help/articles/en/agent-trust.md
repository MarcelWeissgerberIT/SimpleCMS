---
id: agent-trust
title: Trust per field
section: ai
order: 16
keywords: trust, trust per field, direct, verdict, verdicts, reason, reasons, wrong, not now, duplicate, handled already, spot check, lesson, meter, review keys, discard with a reason, Vertrauen, direkt, Urteil, Grund, falsch, Stichprobe, Lektion
related: custom-agents, preflight, history, flight-recorder, memory, integrations
summary: Every proposal you decide on its own is a verdict about that field. One sees, per field, whether an agent has earned your trust — and you say why you discard.
---
An agent that proposes changes for review learns nothing from a plain “discard”. **Trust per field** keeps, on this device, what you decided about each kind of change an agent makes — per field of a database (*Clarity*, *Why* …), per new row, per page it writes to — and shows it on the agent's page as a meter of the last 20 verdicts.

## Discard with a reason
In a run's review (the agent's page, **Runs**) and in [Preflight](help:preflight)'s queue these keys work on the proposal that has the focus:

- **A** — apply. **D** — discard without a reason.
- **1** — discard as **wrong**; in German also **F**, in English also **W**. Only this one counts against the agent.
- **2** not now · **3** duplicate · **4** handled already — discarded, but nothing was wrong with the proposal: no mark against the agent.

In a run's review also:
- **↵** (on the row itself) — apply. **Del** (⌫ on a Mac) — discard without a reason.
- **J** / **N** / **↓** next · **K** / **↑** previous · **Z** undo the decision in its row. Other letters (E, H …) do nothing there.

Preflight keeps its own meaning for the other keys — **E** shows more (the run’s report), **Z** undoes the last thing done in the queue (see [Preflight](help:preflight)).

Only the proposal holding the focus shows its key caps, the orange **Apply** and the row **Discard with a reason**. A decision keeps its **Undo** in its row (“Discarded · wrong · Undo”); focus goes on to the next open proposal, never to the Undo. Keys never act while you type, and never where the buttons would not: a read-only workspace, a run still going, a proposal that needs another one first — a short message says why.

On a touch screen there are no key caps: **Discard ▾** opens the reasons — **Wrong**, **Not now**, **Duplicate**, **Handled already** — and **No reason**.

Proposals of one field and one value you discarded as wrong earlier fold into one quiet line, such as “Wrong × 3 · NL-216 NL-217 NL-218 · Clarity → Blocked”.

## What counts
A verdict is written only when **you** decide on **one** proposal you saw in full — a text longer than its preview counts once you opened it with **Show … more lines** in the run's review:
- **Applied** — the field counts as right. If you change that value yourself within 10 minutes, it counts as **edited** instead (an automation, a sync, another agent, a button or the Outbox's “Mark as sent” changing it does not).
- **Discarded as wrong** — a mark against the agent.
- **Not now**, **duplicate**, **handled already** — no mark, and the run of good verdicts goes on.
- **Discarded without a reason** — no mark either; but more than two of them in a row make the field wait: say with **1** whether it was wrong.

**Apply all**, **Discard all**, Preflight's **⇧A** and **X**, agents that apply directly, the AI terminal, a Preflight card whose body was still loading and a decision the team server did not take write **nothing**. **Undo** of your decision takes its verdict back — an Undo that keeps a field you edited since takes back the verdicts of the fields it did put back.

## The meter
The plate **Trust per field** beside the runs (below them on a phone) shows, per field, the last 20 verdicts, oldest left — every detail is a shape, not only a colour:
- a full green segment — applied unchanged · green with a cut foot — spot check right
- a hollow one — edited by you · an orange, raised one with a slit — wrong
- an orange hatched one — undone · a low tick — no verdict yet

Next to it “15/20” counts the green ones, and a line says how far the field is — “20 in a row”, “3 × wrong · 1 × edited”, “Often reworded by you”, “2 verdicts · too rare”. A field is **ready** after 20 unchanged applies in a row, with nothing undone in the last 14 days. Fields an agent may never write directly are named under **Never direct** (*only by hand* in the [integration](help:integrations) profile, the database's key); page text, new pages, new databases or properties, new options, the trash, sending out, starting coding and memory always wait for review.

In this release the plate only reads: every field still waits for your review. Letting an agent write a ready field directly comes next.

## This device
Verdicts stay in this browser (in a team workspace: yours, per member). They are never synced, exported, backed up or sent to Claude. Removing a team workspace's copy from this browser, or erasing the local workspace, removes them too; the books of agents deleted long ago are cleared by themselves.
