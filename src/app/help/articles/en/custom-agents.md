---
id: custom-agents
title: Custom agents
section: ai
order: 4
keywords: custom agents, agents, schedule, recurring, automate, trigger, recipe, report, server agent, webhook, budget, MCP tools, read-only tools, state, inbox note, Eigene Agenten, Agenten, Zeitplan
related: agent, automations, mcp-servers, gmail-sync
summary: Saved AI helpers for recurring work — each with a job, a trigger and limits. They run on their own and report back.
---
**Agents** in the sidebar lists your custom agents. **New agent** starts from a recipe — *Daily mail triage*, *Weekly report from projects*, *Summarise new form answers*, *Check pages against your knowledge base* — or **Blank**. Nothing runs until you save.

## What an agent has
- **Job** — a **Name** and **Instructions** in plain words (**Improve with Claude** polishes them).
- **Trigger** — **Manual**, **Schedule** (hourly, daily, weekdays, weekly, monthly, at a time and time zone), **New row** in a database (form answers and synced mails included), **Row changed**, or **Webhook** (server agents only).
- **Access** — **May use**: everything, or chosen pages and databases. **Changes**: **Read only**, **Proposals for review** or **Apply directly** (written as “Agent · name”, undoable in the version history). **MCP servers** it may call, e.g. your knowledge base.
- **Report** — an optional **Report page** each run writes to (added at the end, or replacing it).
- **Engine** — **Runs where**, **Model**, **Effort** and a **Budget per run**: the run stops when its estimated cost goes over.

## Tools, state and notes
- **MCP tools** — under each MCP server you tick, the tools of its last connection test: untick what the agent must not use. **Read-only tools** keeps only the ones that look like reads (get, list, search, query, read, fetch, find …); **All** allows every tool, also ones the server adds later. A server that was never tested says **Test the connection first** (**Settings → Claude AI → MCP servers**).
- **Last run** — every run knows when the agent's last successful run was, so a recurring job can look at what changed since then.
- **Saved state** — an agent can keep a small note of its own between runs (where it stopped, what it has seen). It is saved only when a run finishes without an error. Browser agents keep it on this device — the agent page shows it, and **Clear** makes the next run start from scratch; server agents keep it on the team server, encrypted.
- **Notes for you** — a browser agent can leave you a short note in the **Inbox** (“New comment on #8215”, “3 items became ready”), linked to the page it is about. Notes arrive only when the run finishes, at most ten per run; browser notifications only if you switched them on in the inbox. Server agents put their news into the report.
- A scheduled agent that **applies** changes shows a short message (“Agent · name: 3 changes”) with **Open**.

## Runs
**Run now** starts one at once. Every run is listed under **Runs** with its report, its steps and its cost; proposals wait there for **Review**, and the sidebar shows how many are waiting.

## Browser or server
- **Browser** agents run in One while a tab is open — with your Claude key and your MCP servers. A scheduled run missed while One was closed happens once, the next time it opens.
- **Server** agents (team workspaces) run on the team server around the clock, with a Claude key and MCP servers an admin sets up under **Settings → Agents · MCP**.
