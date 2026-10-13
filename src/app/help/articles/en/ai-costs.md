---
id: ai-costs
title: What AI requests cost
section: ai
order: 17
keywords: cost, costs, openrouter, credits, jev router, reported, catalogue, price, prices, receipt, receipts, tokens, usage, spend, budget, estimate, table, cache, cache read, cache write, refusal fallback, spend limit, ledger, /cost, Kosten, Preis, Preise, Beleg, Belege, Schätzung, Tabelle, Verbrauch, Ausgabenlimit
related: ai-providers, ai-data-rules, claude-key, ai-menu, agent, custom-agents
summary: Every AI request in One gets a receipt — the model that answered, what it cost and how One priced it. Your provider bills the real amount.
---
One sends AI requests with your own key, so your provider bills them — Anthropic for Claude, OpenRouter from your prepaid credits. One meters every answer on this device and shows what it cost.

## Where you see it
- **AI menu:** under each result a receipt line, for example `Claude Sonnet 5.5 · $0.0040 · TABLE`. Hover it for the tokens (in, cache write, cache read, out) and the date of the price table. A result with several requests (Transform → Auto, an MCP server that paused the answer) adds them up.
- **[AI terminal](help:agent):** the footer adds up the conversation; `/cost` (`/kosten`) lists a row per model that answered — requests, tokens in, cache write / read, out, the cost and how it was priced — and the total. Change the model mid-conversation and both models get a row. The request after a task that proposes what to remember counts in too. *In* is always the input outside the cache — cache writes and reads have their own figures.
- **[Agents](help:custom-agents):** each run lists a line per model under its usage. The run's budget counts the same sum.

## How One prices
- **Table** — the tokens the provider reported × One's dated price table. Cache reads and cache writes have their own prices and are never counted twice.
- **Estimate** — an answer that was stopped or failed before its usage arrived: the input the provider reported when it started (else the request's size — the prompt, a document's pages, a picture, the tools) plus the characters that came in. The amount reads `≈`; amounts without `≈` come from the table.
- **Price unknown** — a model the table does not know. A budgeted agent run stops rather than run past a budget it cannot count.
- A request your provider turned away before answering (a rate limit, an overload) is listed at no cost — also when you stop it while it waits to try again. A request stopped before it went out is not listed at all.

## Another model answered
Anthropic may hand a request the chosen model declines to another Claude model. The receipt then names the model that answered and adds the line *Anthropic passed this to Claude Sonnet 5.5*. Each part is priced at the model that ran it: what the chosen model read before it declined at its price, the answer at the other model's. The terminal and agent runs show the same line.

## OpenRouter and the Jev Router
OpenRouter answers with the cost of each request: the receipt then reads **REPORTED**. Without a reported cost One prices the answer at the model's catalogue row (**CATALOGUE**). OpenRouter works on prepaid credits (from $5; it takes a fee on top-ups) — each model costs its list price, shown in step 03 and in the picker. The **Jev Router** is priced per request and reported too; the receipt names the model it picked (*OpenRouter · Jev Router → …*). Before such a request One reserves the most expensive model of your list.

## Jev as a pre-checker
Each answer of a [pre-check](help:ai-jev) is its own entry: priced at the cost OpenRouter reports, else at Jev's catalogue row — Jev's output is free (its token count is kept). A run's receipt lists **Jev 1.13 · pre-check** on its own line ("in → out free"), and the agent's budget counts it; before the checks One reserves what all of them may cost, and a run whose budget is smaller sends none.

## What is kept
The record behind the receipts stays on this device: ids, models, token counts, amounts — never page text. It keeps 90 days, is never synced, exported or backed up, and goes when you remove a workspace's copy from this device or reset the app here. In a team each member has their own.

> These are One's figures from list prices or the provider's report. The binding amount, and a hard spend limit, live with your provider — for Claude in the Anthropic console (**console.anthropic.com → Settings → Limits**), for OpenRouter as the key's limit (**openrouter.ai → Settings → Keys**, shown live in Settings → AI).
