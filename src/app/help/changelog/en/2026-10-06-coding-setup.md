---
id: 2026-10-06-coding-setup
date: 2026-10-06
order: 2
title: The coding worker in three steps — download, start, tick your repos
summary: The worker now comes ready-paired from One, finds the git repositories on your computer and lets you tick the ones One may work in — no config file to write.
image: assets/shots/changelog/coding-setup.webp
alt: Settings → Coding worker with the three steps done — the worker downloaded for this workspace, started with node ~/Downloads/one-worker.mjs, two repositories ticked — and the status Connected · studio-mac · 2 repos
help: coding-pipeline
try: coding
---
Setting up the coding worker used to mean an init command and a hand-written `worker.json`. Now it is one card in **Settings → Coding worker** (and on **#/coding**):

1. **Download the worker for this workspace** — the file is already paired with this browser and this workspace. One switches the link on by itself.
2. **Start it**: `node ~/Downloads/one-worker.mjs`.
3. **Tick your repositories in the page that opens.** The worker looks for git repositories on your computer and opens a small page in your browser: tick a repo, check its base branch and test command, **Save & start**. One shows *Connected · laptop · 2 repos* right away.

**Change repositories** opens that page again later. Only the names of your repos come to One — paths and commands stay on your computer, and One can never tick a repo itself. A new download replaces the pairing, so an older copy of the file stops working. More in [the guide](help:coding-pipeline).
