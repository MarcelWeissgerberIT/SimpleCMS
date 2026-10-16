---
id: 2026-10-16-worker-permissions
date: 2026-10-16
order: 3
title: Claude Code asks you — and stops when it is done
summary: When Claude Code needs a permission, the coding task asks you in One — once, always for this repo, or no. A stage ends the moment Claude Code ends, and one that reached its step limit continues where it stopped.
image: assets/shots/changelog/worker-permissions.webp
alt: Two coding tasks in One — left the card “Claude wants · Bash npm run lint” with Allow once, Always allow for this repo and Refuse; right “Step limit reached (3/3)” with Continue (+3 steps) and Start over.
help: coding-pipeline
try: coding
---
**Claude wants …** When Claude Code needs a permission your repository's rules do not cover — a command, a tool, a file outside the project — the task shows **WAITING FOR YOU · PERMISSION** and a card that says exactly what. **Allow once**, **Always allow for this repo** (the worker keeps that one narrow rule in its own `worker.json`; its setup page lists them with a key to remove each) or **Refuse**. Preflight's lamp **Claude wants** lights for every request, and the browser tells you while One is in the background. Without an answer the worker refuses after 15 minutes.

**Done means done.** A stage ends when Claude Code ends — with every model. A dev server or watcher it left running is stopped, and the log names it. Each task gets a scratch folder for its temporary files.

**Step limit reached?** **Continue (+N steps)** runs the stage on from where it stopped, in the same worktree; **Start over** runs it again from the beginning. The pipeline editor shows each stage's **Step limit**.

Needs worker 1.11.0: **Download again** in Settings → Coding worker. More: [Coding pipeline](help:coding-pipeline).
