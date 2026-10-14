---
id: 2026-10-14-worker-windows
date: 2026-10-14
order: 1
title: Coding worker 1.9.0 — native on Windows
summary: The coding worker runs directly on Windows 10 and 11 — start it from PowerShell or the Command Prompt. On Windows, use 1.9.0 or newer.
image: assets/shots/changelog/worker-windows.webp
alt: Settings → Coding worker, step 2 "Start it" with the switch Your computer set to Windows — a PowerShell line and a Command Prompt line, each with its copy key, and the note on Git for Windows and Windows Terminal.
help: coding-pipeline
try: settings-coding
---
**Start it on Windows.** **Settings → Coding worker** shows the start line for your computer — switch **Windows | macOS · Linux**. On Windows you get one line for PowerShell and one for the Command Prompt, the path in quotes, so a user folder with a space works. You need Node.js 22 or newer, **Git for Windows** (Claude Code needs its Git Bash) and Claude Code — its own installer or npm — signed in once. `node one-worker.mjs check` says what the worker found.

**On Windows, use 1.9.0 or newer.** Windows looks for a program in the folder it starts in before `PATH`, and the worker runs git and Claude Code inside your repositories — so an older worker could start a program named `git.exe`, `claude.exe` or `npm.exe` that a cloned or imported repository brought along. 1.9.0 looks in `PATH` only, never in the repository, and nothing One sends ever runs through `cmd.exe`. Running an older worker on Windows? **Download again** and start the new file. On macOS and Linux nothing changes.

**Windows' corners, handled.** Long paths, repositories in OneDrive (the worker warns and keeps its worktrees out of it), SSH keys and sign-ins that would wait for a question nobody sees: the worker now stops at once and says in the log, in your language, what to do. WSL2 works too. More: [Coding pipeline](help:coding-pipeline).
