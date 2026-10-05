---
id: 2026-10-04-custom-agents
date: 2026-10-04
order: 1
title: Custom agents
summary: Saved AI helpers for recurring work — a job in plain words, a trigger, limits — that run on their own and report back.
image: assets/shots/changelog/custom-agents.webp
alt: A custom agent with its schedule, access and budget, and a run waiting for review
help: custom-agents, agent, mcp-servers
try: agents
---
**Agents** in the sidebar lists your custom agents. Start from a recipe — *Daily mail triage*, *Weekly report from projects*, *Summarise new form answers* — or from scratch.

- **Job:** a name and instructions in plain words.
- **Trigger:** by hand, on a schedule (daily, weekdays, weekly …), when a row is added or changed — form answers and synced mails included — or by webhook on a team server.
- **Limits:** what it may read and change, which MCP servers it may call, and a budget per run.

By default an agent stages its changes for your **Review**; the sidebar shows how many wait. Browser agents run while One is open, a missed run catches up once. In a team workspace, server agents run **around the clock** on your own server.

> Tip: **Run now** starts a run at once — the quickest way to check a new agent before you put it on a schedule.
