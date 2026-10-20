---
id: 2026-10-20-agent-assignments
date: 2026-10-20
order: 3
title: Give an agent a one-time assignment
summary: Choose a target page per run, follow it in Patchbay, and save its report wherever you need it.
image: assets/shots/changelog/agent-assignments.webp
alt: Agent assignment dialog with a selected page and a one-time analysis objective.
help: custom-agents, patchbay
try: agents
---
Use **Run an agent on this page…** in a page’s options, or **Assignment & target…** beside the agent’s quick-run button. Choose the agent, target page and an optional objective. It applies to this run only; the saved instructions, tools, scope, write mode, budget and review rules stay in force. An inaccessible target stops the start.

One-time runs keep their objective and target in the run history. They do not advance the recurring job’s cursor, replace its older proposals or automatically write to its default report page. The next quick or scheduled run uses the saved job again. Server agents need a server advertising `agent-invocation`; an older one is refused before any start request.

**Patchbay → Manual agent assignments** shows target → agent → result, status and recent tool activity. The result opens that specific run. After you save the report, it links to the destination instead.

At any finished report, choose **Save report…**: create a new page, append to an existing page or create an ordinary database entry. Existing text remains. The report includes links back to its run and source page. Locked pages, templates and system/pipeline databases are excluded. The saved-report link is remembered on this device; the page or row itself belongs to the workspace.
