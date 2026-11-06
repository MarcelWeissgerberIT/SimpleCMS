---
id: 2026-10-21-worker-workspaces
date: 2026-10-21
order: 2
title: One device worker, separate workspaces
summary: Allow additional workspaces once; retain model connections and isolate each task’s state.
image: assets/shots/changelog/worker-workspaces.webp
alt: TestSpace settings with the button to allow this workspace on the running device worker.
help: coding-pipeline, workspace
try: settings-coding
---
A paired local coding worker can now serve several explicitly allowed workspaces. Start worker **1.22** in its original workspace first. In another workspace, open **Settings → Coding worker** and choose **Allow this workspace on the device worker**. Use the original browser profile.

Models, API keys and personal MCP connections stay on the device. Each additional workspace gets its own pairing key, task state, memory, scratch folders, worktrees and generated branches. Switching workspaces cannot redirect a running task or its results. The worker shares repository locks, concurrency and daily limits across contexts.

Revoke additional access on the worker’s protected setup page under **Additional workspaces on this device**. This stops that workspace’s tasks and retains saved work. Cloud relay workers retain their workspace and member-token binding.
