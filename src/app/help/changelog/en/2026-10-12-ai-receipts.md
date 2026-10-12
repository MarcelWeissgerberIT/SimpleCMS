---
id: 2026-10-12-ai-receipts
date: 2026-10-12
order: 1
title: A receipt for every AI request
summary: Every answer from Claude now says which model gave it and what it cost — in the AI menu, the AI terminal and on agent runs.
image: assets/shots/changelog/ai-receipts.webp
alt: Left, the AI menu after "Improve writing" with the receipt line "Receipt Claude Opus 5.5 · $0.0164 · Table" under the result; right, the AI terminal after two tasks on two models and /cost — a row for Claude Opus 5.5 and one for Claude Sonnet 5.5 with requests, tokens in, cache write / read, out, cost and source, and the total.
help: ai-costs, claude-key, agent
try: terminal
---
**A receipt under each result.** The AI menu shows one line under the answer: the model that answered, what the request cost and how One priced it — **Table** for One's dated price list, **Estimate** (≈) for an answer you stopped before it finished. Hover it for the tokens.

**`/cost` per model.** In the [AI terminal](help:agent), `/cost` (or `/kosten`) lists a row per model that answered in this conversation — requests, tokens in, cache write / read, out, the cost — and the total. Switch the model mid-conversation and both appear. The footer adds the conversation up the same way: *In* is the input outside the cache, cache writes and reads stand beside it.

**Agent runs** list a line per model under their usage; the run's budget counts the same sum.

**When another model answers.** If Anthropic passes a request to another Claude model, the receipt says so and prices each part at the model that ran it.

The record stays on this device and holds no page text. More in [What AI requests cost](help:ai-costs).
