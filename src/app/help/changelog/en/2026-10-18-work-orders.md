---
id: 2026-10-18-work-orders
date: 2026-10-18
order: 1
title: Work orders: from a request to a chain
summary: Write down what should be checked — One plans a chain of pipeline tasks from it (Business analysis, Coding, QA), shows every step in full, and runs them one after another once you start it.
image: assets/shots/changelog/work-orders.webp
alt: A work order's plate in Chain ready — the lamps Coding, Worker, Context (the person's own server, read only) and Planner, the planner's summary, the server's context marked OUTSIDE with the call it made, and three stations (01 analysis, 02 coding, 03 QA), each with its project, repo, where it stops and its goal.
help: workorders, pipelines, coding-pipeline, patchbay
try: workorders
---
**Write down what should be checked** — in a row of the new **Work orders** database, or on any page with **Have it checked** (⋯, the sidebar row's menu, ⌘K). One press lets One read the request, the pages it links and — when you picked one — your own MCP server, with its read tools only. It plans a **chain**: Business analysis, then Coding, then QA.

**Every step in full, then one ↵.** The plate shows each step with its goal, criteria, project, repo, the pages that go along and where it stops for you; content from your server is marked *OUTSIDE*. **↵ Start chain** creates all the tasks; step 01 starts after 10 seconds (<kbd>Z</kbd> takes the whole chain back). From then on each step hands its result to the next one as its basis and starts it — after the analysis One shows you the coding step first.

**Only you start.** Planning, the start and every key that sends work to the worker are your own presses — BY HAND in Preflight, never in a bulk apply. <kbd>H</kbd> halts after the running step, **↵ Resume** goes on, and a **Budget per chain** halts before the next step. **Start without confirming** exists as a switch per device, in local workspaces, with a budget. It all needs Coding on this device and a connected worker.

**In the Patchbay**, every work orders database is a **Planner** module. Hand-ons are now visible in the Patchbay — Then, stories and the chain's next steps are drawn as cables — so an existing setup may show a new fuse. More in [Work orders](help:workorders).
