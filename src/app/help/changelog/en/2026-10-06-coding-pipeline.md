---
id: 2026-10-06-coding-pipeline
date: 2026-10-06
order: 1
title: Coding pipeline — Claude Code on your machine, steered from One
summary: Hand coding tasks to a small worker on your computer: it plans, implements, tests and ships them with Claude Code in a git worktree per task — you approve at the gates.
image: assets/shots/changelog/coding-pipeline.webp
alt: A coding task in One waiting at Review — the stage timeline from Backlog to Done, the Approve and Rework keys, and the Diff tab with the change to src/login.ts in syntax colours
help: coding-pipeline, mcp-bridge
try: coding
---
**#/coding** turns One into the control centre for code work. `one-worker` runs on your computer, takes tasks from One and works on them with **Claude Code** — each task on its own branch in its own git worktree, your main checkout untouched.

- **The pipeline**: Backlog → Ready → **Plan** (Claude Code in plan mode) → **Approve plan** → **Implement** → **Test** (your test command; a failure goes back once with the output) → **Review** → **Ship** (commit, push, pull request) → Done. Edit the stages under **Pipeline**.
- **The task panel**: a live log, the plan, the diff per file, test output, the git state — and **Approve**, **Rework…**, **Answer** (when Claude asks), **Stop**, **Retry**. Force push and Discard ask twice.
- **Set up** in **Settings → Coding worker**: save `one-worker.mjs`, run the init command shown there, add your repos to `worker.json`, keep it running.

Paths and commands stay on your machine; One only learns repo names, branches, diffs and logs. Claude Code keeps its permission rules, cost limits per task and per day live in your config — see [the guide](help:coding-pipeline).
