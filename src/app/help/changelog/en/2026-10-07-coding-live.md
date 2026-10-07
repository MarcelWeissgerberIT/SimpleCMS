---
id: 2026-10-07-coding-live
date: 2026-10-07
order: 4
title: Coding tasks you can watch
summary: While a coding task runs, its panel shows what the worker did last and how long ago, the step of the stage's limit, a cost estimate and the files changed so far — and the browser can tell you when a task needs you.
image: assets/shots/changelog/coding-live.webp
alt: A coding task in the Implement stage — the Now line with Claude's last message a few seconds ago, the chips Step 6/30, ≈ +$0.07 and Files 1 +4 −1
help: coding-pipeline
try: coding
---
**Now.** While a stage runs, the task panel shows the worker's last line and how long ago it came — it ticks, so a quiet minute shows as a quiet minute. **#/coding** shows the same line under every running task.

**Counters.** **Step 6/30** is Claude Code's turn of the stage's limit (*Max turns* in the pipeline). **≈ +$0.07** is what this stage has cost so far, on top of the task's cost above — an estimate from the tokens; the exact cost still comes when the stage ends. **Files** counts what changed in the task's worktree with its added and removed lines — it follows along while Claude Code edits, and a click opens the diff.

**Notifications.** In **Settings → Coding worker**, switch on *Notify me while One is in the background*: when a task waits at a gate, has a question, failed or is done while the tab is in the background, the browser says so. A click brings One forward on the task. It is kept on this device.

**In your language.** The worker's own lines (stage, branch, fetch, tests, commit, push) now show in German too. Download the worker again (**Settings → Coding worker**) to get the counters and the live diff.
