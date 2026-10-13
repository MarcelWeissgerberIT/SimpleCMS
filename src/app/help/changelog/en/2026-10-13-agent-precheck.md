---
id: 2026-10-13-agent-precheck
date: 2026-10-13
order: 1
title: Jev pre-checks your agents' proposals
summary: An optional second opinion on every change an agent proposes — four questions, a line on each card, and proposals with concerns held back for you.
image: assets/shots/changelog/agent-precheck.webp
alt: Left, section 06 "Check" of an agent's editor with the pre-check on, Jev 1.13 chosen, mark below 0.70, "Hold back" picked and the Start values tag; right, the agent's run review with a held-back change, a change close to the threshold and a clear one, each with its Jev line.
help: ai-jev, custom-agents, agent-trust, ai-costs
try: agent-precheck
---
**A pre-check for agents.** In an agent's editor, section **06 — Check** switches on Jev (by TypeSafe, via OpenRouter) as a pre-checker. Before a run's proposals reach you, Jev answers four questions about each change: asked for, right row, agrees with the record, free of foreign orders.

**A line on every card.** Preflight and the run review show what Jev found: nothing to report, close to the threshold, or a concern with the question it is about. **Hold back** keeps proposals with concerns out of "Apply all" and ⇧A — you apply them one at a time.

**Write gate.** For agents that apply directly: the run writes only when Jev agrees on every change. Otherwise the whole run waits for you.

**Start values.** The thresholds 0.70 and 0.90 are start values, not a measured hit rate — a check can miss things. Jev only ever adds caution: it never applies, discards or decides anything, and it never counts as your trust.

Off until you switch it on, per agent. "Sourced?" — Jev checking answers of the help and of "Ask the workspace" against their sources — is a separate switch in **Settings → AI**. More in [Jev as a pre-checker](help:ai-jev).
