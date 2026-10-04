---
id: agent
title: The agent
section: ai
order: 3
keywords: agent, claude, automate, bulk, tasks, rows, pages, workspace agent, apply, review, Agent, Aufgaben, automatisieren
related: custom-agents, ai-menu, mcp-servers, mcp-bridge
summary: Describe a task for your workspace — Claude reads, proposes changes, and you apply them.
---
Press <kbd>Mod+J</kbd> (or ⌘K → *Ask the agent…*). The agent opens on the right.

1. Describe a task, e.g. *“Turn this week's meeting notes into action items in Projects”* or *“Tag every reading-list item with a type”*.
2. Press <kbd>Enter</kbd>. Claude searches and reads your pages and databases; every step shows up in the log.
3. Changes are **proposed**, not written: new pages, new rows, changed properties and titles land in a review list.
4. Check them, then **Apply** one by one or **Apply all** (<kbd>Mod+Enter</kbd>). **Discard** what you don't want; **Restore** brings a discarded proposal back.

Ask a follow-up or a correction in the same field. **New task** starts over; **Stop** ends a run — the proposals so far stay.

## Good to know
- The meter at the bottom shows tokens and an estimated cost of the task (your key).
- A task ends at a limit of tool calls; Claude is asked to wrap up.
- MCP servers you added (e.g. your knowledge base) are available to the agent.
- Nothing changes until you apply. In a team workspace, viewers see the proposals but cannot apply them.
