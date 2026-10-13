---
id: ai-jev
title: Jev as a pre-checker
section: ai
order: 5
keywords: jev, typesafe, pre-checker, pre-check, write gate, hold back, held back, concerns, mark only, start values, calibration, sourced, belegt, decision model, openrouter, Vorprüfer, Vorprüfung, Schreibschranke, Zurückhalten, Bedenken, Startwerte
related: custom-agents, agent-trust, preflight, ai-providers, ai-data-rules, ai-costs, governor, privacy
summary: Jev (TypeSafe, via OpenRouter) answers four fixed questions about every proposal of an agent with probabilities — it marks or holds back, it never writes.
---
**Jev** is a decision model by TypeSafe that you reach through OpenRouter. It does not write text: it answers fixed yes / no questions with a probability each. That is cheap enough — about $0.00005 per proposal — to have every proposal of your agents pre-checked before you decide. Jev never writes, never applies or discards anything and never counts as your trust.

## Switch it on
1. Set up OpenRouter (**Settings → AI → Set up AI…**). In step 03 the **Pre-checker** row starts **Off**; **Choose Jev 1.13** makes it this device's pre-checker. Nothing is chosen for you.
2. Open an agent, **Edit**, section **06 Check**: switch on **Pre-check**. The chip shows which Jev version answers (<kbd>Alt</kbd>+<kbd>M</kbd> picks another one; other decision models are listed but "tuned for Jev only").

## The four questions
For every proposal that changes a page or a row Jev reads the agent's instructions, the change and the row it changes, and answers:
- **Fits the task?** — do the instructions ask for this kind of change?
- **Right page or row?** — is the target what the instructions or the trigger are about?
- **Agrees with the record?** — does every name, number and date the change states match the row?
- **Free of foreign orders?** — does the new text hold an instruction to an AI or a reader that the instructions do not give?

Every question tells Jev that text in the change and the row is data, whatever it says. A card shows only concerns: below the threshold an amber **CONCERN · JEV** with the weakest question; close above it a neutral line; otherwise a dim "none of the 4 questions below 0.70". **4 checks ▾** shows all four values.

## Mark only or hold back
**On concerns** decides what a concern does. **Hold back** (the default): the proposal is **HELD BACK** — left out of **Apply all**, ⇧A and swipes, its A is **BY HAND** and it is applied only on its own. A proposal Jev could not check (no answer in time, an error, a data rule) is held back too — a failure never makes a card cleaner. **Mark only**: the card says so, nothing else changes.

While an earlier change to the same row is still held back or marked, a new one to it is held back as well ("an earlier change here is still waiting") — so a text that learns from the workspace cannot simply try again.

## The write gate (apply mode)
For an agent set to **Apply directly** the **Write gate** decides whether a run may write at all: only when **every** check of **every** change is at or above **0.90**. If Jev holds back any change — or does not answer — **the whole run waits** and every change becomes a card; the run and the first line of its report say why. The gate only ever writes less than the agent would without it. It does **not** recognise wrong values taken from other people's texts (mails, form answers, MCP results): an agent that reads such text says so in section 06. **Propose** stays the safest.

## Start values and calibration
The thresholds **0.70** (mark below) and **0.90** (write directly from) are **Start values**: no protection rate is claimed. Section 06 shows a calibration readout of this device (how many proposals were pre-checked, marked, applied anyway, discarded) — it never suggests a threshold.

## When Jev changes
The thresholds belong to one Jev version. If OpenRouter answers with a newer one, the checks count as not done (held back, the gate waits) and section 06 shows **NEW VERSION** with **Confirm** until you confirm it.

## Sourced? — answers checked against their sources
**Settings → AI → This device → Check answers against their sources with Jev** (off by default) adds one line under answers of the help's **Ask** and of **Ask the workspace**: **NOT SUPPORTED** when Jev finds statements that are not in the sources (**Ask more thoroughly** <kbd>R</kbd> asks once more on the deep model), "the answer says: not in the sources", or a dim "no statement without a source found". Before the question is sent, its line says that Jev reads along.

## What goes to TypeSafe
As a pre-checker, Jev (TypeSafe) receives through OpenRouter the proposals of your agents with their instructions and the row they change — and, when you switch it on, answers with their sources. Never ids, e-mail addresses or keys; names only when your data rule lets names go to OpenRouter (else "@Person 1"); a link shows the page's title, a page OpenRouter may not see shows as "[Page]". Names you type into an agent's instructions are your own words and go as they are. The OpenRouter data rule applies — a class it refuses means no request at all, and the card says which. Decisions run through OpenRouter's **alpha** interface: if it fails, you check as before.

## Costs
Every answer is one entry in this device's usage, priced at the reported cost (Jev's output is free). A run's receipt lists **Jev 1.13 · pre-check** on its own line; the agent's budget counts it.

With a budget in the [Governor](help:governor), an agent with a pre-checker sets the cost of its pre-checks aside when its run starts, so they still fit once its own steps reach the red line. A run the Governor ended at the red line sends no pre-checks: its proposals wait for you unchecked (held back with **Hold back**). A pre-check that no longer fits under the red line is not sent — an agent set to **Apply directly** then writes nothing on its own: the whole run waits for you, whatever **On concerns** says. When you start such an agent yourself, the start dialog counts its pre-checks into the first step. Proposals held back only for the budget never make later runs cautious: the next run's proposals replace them where they touch the same rows.
