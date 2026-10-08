---
id: 2026-10-08-terminal-pipelines
date: 2026-10-08
order: 3
title: The AI terminal runs your pipelines — and signs in to MCP servers
summary: In ⌘J, Claude lists, creates, approves, sends back, answers, runs and stops tasks of the coding pipelines — every change staged for your review; /connect signs in to an MCP server in a browser window.
image: assets/shots/changelog/terminal-pipelines.webp
alt: The AI terminal — /pipelines lists a task waiting at Approve plan and one in the backlog; below, Claude has staged a new Coding task with repo, branch, start, stops, Git and the whole task page as Claude Code reads it, marked STARTS WORKER
help: agent, coding-pipeline, mcp-servers
try: terminal
---
**Pipelines by keyboard.** Press <kbd>Mod+J</kbd> and ask in plain words — *“What waits for me?”*, *“Create a task to export the invoices as CSV and start it”*, *“Send the login plan back: use the existing session store”*. Claude reads the [coding pipelines](help:coding-pipeline) — Coding, Business analysis, QA: what waits, a task's stage, plan, test result and log. It creates tasks and acts on them: approve, send back with a note, answer a question, run once, stop, set *Then*, hand on.

**Nothing moves before you apply.** Each change lands in the review list. A new task shows in full — project, repo, branch, where it starts and stops, its whole page as Claude Code reads it. What starts the worker carries **STARTS WORKER** and is never part of *Apply all*: apply each one on its own (<kbd>Enter</kbd> on it). A task an agent wrote, or one changed on another device, waits for **Confirm on this device** on its page — the terminal never confirms for you.

`/pipelines` lists the open tasks, what waits for you first, with **Open** and — for a running one — **Stop**.

`/connect` (`/verbinden`) lists your [MCP servers](help:mcp-servers) and how they stand. `/connect atlas` — a name, a codeword or an address — signs in: the server's sign-in page opens in a browser window right from your <kbd>Enter</kbd> (or with a code, when the window can't return). `/connect https://…` adds a server first. When a task fails because a server rejected its token, **Sign in to …** sits right under it, then **Run the task again**.
