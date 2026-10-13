---
id: governor
title: Governor: budget and red line
section: ai
order: 18
keywords: governor, regler, budget, day budget, month budget, red line, rotlinie, limit, spend limit, my limit, device limit, brake, pre-brake, halt, pause, allow once, cheaper model, held, usage, verbrauch, consumers, receipts, hard limit, Tagesbudget, Monatsbudget, Grenze, Bremse, Vorab-Bremse, angehalten
related: ai-costs, ai-providers, agent, custom-agents, ai-autofill, preflight, members-roles
summary: A day and month budget for all AI in One, measured on each device, and your own limit for this browser. At the red line One asks before it sends — background work pauses.
---
The **Governor** (Regler) keeps One's AI spending under a red line you set. It counts what every request costs on this device — the same figures as the [receipts](help:ai-costs) — and brakes **before** a request goes out, never after.

Without a budget nothing changes: no request is braked, capped or held, and the Governor only shows what was used.

## Set a budget
- **Workspace settings → AI → § 06 Budget & governor** — a **day budget** and a **month budget** for this workspace (amounts in US dollars, for example `6` or `1.5`). Each device measures it on its own: with $6 a day, your laptop and your phone may each spend $6. In a team only owners and admins change it; everyone else sees it with a lock.
- **Settings → AI → My limit in this browser** — your own day / month limit for this browser. It counts **every workspace and account** signed in here, and it is never synced or backed up. When the workspace has a budget too, the lower red line applies.
- **Undo** puts back what the last save changed. Remove a budget and nothing is braked any more.

## Read the usage
Open the Governor from **⌘K → Governor**, the status bar's **GOVERNOR** cell (shown while a budget is set) or Preflight's **USAGE** lamp. The page `#/regler` shows:
- today, this month and the number of runs, with the dial against the day budget and yesterday's mark; the month bar; your browser's line when you set one;
- **Consumers** — who used what today: the AI terminal, the AI menu, each agent, autofill, mail, ⌘K, help, the Outbox … with their share, and agents the Governor held;
- the **receipt roll** — one stub per run; open it for the receipt with tokens and models. **All** shows the last 30 days.

Nothing is read before you open the page — without a budget One never opens the record at start-up.

## At the red line
Before each request One estimates a band (the least and the most it can cost) and compares its upper end with what is left. What happens then depends on the work:

- **Your own request** (AI menu, Transform, ⌘K "?", help Ask, an Outbox draft, a file or picture): a short text answer may go out with a smaller answer budget — its receipt says so. Otherwise the request is **not sent** and a note says why, with **+$1 once** (E, when that is enough), the **cheaper model** of the same provider (when it fits) and Cancel.
- **The [AI terminal](help:agent)** stops **between two steps** with a halt card: **E** allows $1 more for this task today, **H** finishes with a cheaper model of the same provider when it can carry the conversation (its band includes writing the cache again), **⌘. / Ctrl+.** stops — staged changes stay. Nothing is sent or reserved while the card waits.
- **[Agents](help:custom-agents)** never wait mid-run. A scheduled or triggered run at the line is not started — one *held by the governor* record a day with its count, one note in the inbox, no red lamp. A run that crosses the line stops after its current step; its proposals stay, its state is not saved. **Run now** asks before it starts (↵ = +$1 for that run).
- **[Autofill](help:ai-autofill)**: watched rows pause at the line and stay paused over a reload; they go on when the budget rises, a new day starts, or with **E** in the panel. A job you start shows its estimate against the rest before it starts and waits at a row boundary at the line.
- **Mail organising** pauses — mails stay unorganised until you raise the budget and organise them. A **script's** `claude()` stops the run (Undo run is offered); from an automation only that AI step is skipped. A memory proposal after an answer is skipped.

A model without a price cannot be kept within a budget: while a budget is set, its requests are refused.

## Pre-brake, not a hard limit
The Governor is a **pre-brake in One**: it can overshoot by one step (a stream that runs long, a request on another device). The hard limit is set with each provider:
- **Claude** — the spend limit in the Claude Console (**console.anthropic.com → Settings → Limits**).
- **OpenRouter** — the key's limit (**openrouter.ai → Settings → Keys**); One shows what is left live.
- **OpenAI** — the project limit in the OpenAI dashboard.

In a team, server agents run on the workspace's key and are not counted here. Claude Code in a coding worker is not counted in the day budget either.

## What is stored
The budget is part of the workspace (team: shared, owners and admins only). Your browser's limit and the Governor's day totals stay in this browser — never synced, exported or backed up — and go with the device copy. Older versions of One that cannot keep a budget ask you to reload before they send AI requests.
