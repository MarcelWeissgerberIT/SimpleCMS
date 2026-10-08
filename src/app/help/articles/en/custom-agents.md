---
id: custom-agents
title: Custom agents
section: ai
order: 4
keywords: custom agents, agents, schedule, recurring, automate, trigger, recipe, report, server agent, webhook, budget, Eigene Agenten, Agenten, Zeitplan
related: agent, automations, mcp-servers, gmail-sync
summary: Saved AI helpers for recurring work — each with a job, a trigger and limits. They run on their own and report back.
---
**Agents** in the sidebar lists your custom agents. **New agent** starts from a recipe — *Daily mail triage*, *Weekly report from projects*, *Summarise new form answers*, *Check pages against your knowledge base* — or **Blank**. Nothing runs until you save.

## What an agent has
- **Job** — a **Name** and **Instructions** in plain words (**Improve with Claude** polishes them). The field numbers its lines and underlines the tools the agent can use (One’s and its MCP servers’); placeholders in capitals like `[HOW TO LIST THE ITEMS]` are marked and counted — **Next placeholder** jumps to one, and **Run now** asks first while any is open.
- **Trigger** — **Manual**, **Schedule** (hourly, daily, weekdays, weekly, monthly, at a time and time zone), **New row** in a database (form answers and synced mails included), **Row changed**, or **Webhook** (server agents only).
- **Access** — **May use**: everything, or chosen pages and databases. **Changes**: **Read only**, **Proposals for review** or **Apply directly** (written as “Agent · name”, undoable in the version history). **MCP servers** it may call, e.g. your knowledge base.
- **Report** — an optional **Report page** each run writes to (added at the end, or replacing it).
- **Engine** — **Runs where**, **Model**, **Effort** and a **Budget per run**: the run stops when its estimated cost goes over.

## Runs
**Run now** starts one at once. Every run is listed under **Runs** with its report, its steps and its cost; proposals wait there for **Review**, and the sidebar shows how many are waiting.

## Browser or server
- **Browser** agents run in One while a tab is open — with your Claude key and your MCP servers. A scheduled run missed while One was closed happens once, the next time it opens.
- **Server** agents (team workspaces) run on the team server around the clock, with a Claude key and MCP servers an admin sets up under **Settings → Agents · MCP**.
