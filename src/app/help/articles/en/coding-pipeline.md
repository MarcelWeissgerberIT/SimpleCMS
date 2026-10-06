---
id: coding-pipeline
title: Coding pipeline (Claude Code on your machine)
section: ai
order: 9
keywords: coding, pipeline, claude code, worker, one-worker, git, branch, worktree, pull request, pr, diff, tests, repo, repository, code review, programmieren, aufgaben
related: mcp-bridge, custom-agents, agent
summary: Hand coding tasks to Claude Code on your computer — plan, approve, implement, test, ship — and follow every step in One.
---
**#/coding** (⌘K *Coding pipeline*). One keeps the tasks, the approvals, the log and the diff; a small worker on **your** computer runs git and Claude Code. Your code never leaves your machine.

## Set up once
1. You need Node.js 20+, git and the **Claude Code** CLI, signed in (`claude`).
2. **Settings → Coding worker → Setup**: save `one-worker.mjs`, then run the init command shown there — it binds the worker to this workspace:
```
node ~/one-worker.mjs init --workspace local:…
```
3. Add your repositories to `~/.config/one/worker.json`: a name, the path, the base branch and — for the Test stage — a test command as a list, e.g. `["npm", "test"]`. Then `node ~/one-worker.mjs check` and keep `node ~/one-worker.mjs` running.
4. Switch on **Connect to a coding worker on this computer**. The **WORKER** LED in the status bar turns green.

## A task from start to finish
1. **New task**: title, repo, goal, acceptance criteria. Leave *The worker may start right away* ticked.
2. **Plan** — Claude Code reads the code in plan mode (it changes nothing) and writes the plan into the task. The task waits at **Approve plan**.
3. **Approve**, or **Rework…** with instructions: it goes back to Plan with your note.
4. **Implement** — Claude Code changes the code in its own git worktree; **Test** runs your test command. If the tests fail, Implement gets one more try with their output.
5. **Review** — the **Diff** and **Tests** tabs show what changed. Approve, or send it back.
6. **Ship** — commit, push, pull request (with the GitHub CLI) or a compare link. **Done**.

Each task works on its own branch (`one/<title>-<id>`) in its own worktree — your main checkout stays as it is. To continue on an existing branch, put its name into the task's **Branch** field.

## While it runs
- **Log** streams what Claude Code does. If Claude needs a decision, the task shows **Claude asks** — your **Answer** starts the stage again.
- **Stop** ends Claude Code at once; **Retry** or **Run now** start the stage again.
- **Git**: Refresh, Commit, Push, Open PR, Update from base, Show folder (the path appears in the worker's terminal only). **Force push** and **Discard worktree** ask twice; **Clean up** waits until the branch is merged.
- **Pipeline** (on #/coding) changes the stages: names, which ones run by themselves, Claude Code's mode, turns and instructions.

## Safety
The worker touches only the repos in its own config; One can send it task text and fixed git actions — never a command. Claude Code keeps its permission rules, and task text goes to it as data, not as instructions. Cost limits per task and per day live in `worker.json`. In a team workspace your worker only takes tasks you wrote or confirmed on this device (**Confirm on this device**).

> Tip: the full reference — config keys, protocol, troubleshooting — is `docs/CODING.md` in the repository.
