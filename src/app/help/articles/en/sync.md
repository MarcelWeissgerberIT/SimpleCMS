---
id: sync
title: Folder & GitHub sync
section: sync
order: 1
keywords: sync, folder, github, markdown, git, repository, backup, files, obsidian, token, Ordner, Sync, Repository
related: export, offline-app, privacy
summary: Keep a live, readable copy of the workspace as Markdown files — in a folder and in a GitHub repository.
---
**Settings → Sync.** One file per page, front matter on top, attachments next to them. These settings belong to this device only.

## A folder on this computer
1. **Choose folder…** and allow access. Every change is written there within seconds.
2. Edit the files with any editor; **Pick up changes** (or coming back to One) reads your edits in.
3. After a reload the browser asks once more: **Allow access**.

Works in Chrome and Edge. Other browsers can't write to a folder — use **Export as Markdown** instead.

## A GitHub repository
1. **Repository** — `owner/repo`, one you own (private is fine). **Branch** (created on the first push) and an optional **Folder in the repository**.
2. **Access token** — a *fine-grained personal access token* with **Contents: Read and write** for this one repository (**Create one on GitHub**). It is stored encrypted in this browser only.
3. **Test connection**, then **Push now**. **Push automatically** commits on an interval while One is open. **Pull** brings in edits made on GitHub.
4. **Include my private pages** is off by default: the repository's collaborators could read them.

## Conflicts and deletions
Edited on both sides? One's version stays; the other is kept as a “(conflict …)” copy. Files deleted outside One never delete pages on their own — One asks: **Move pages to trash** or **Write files again**.

> The status bar shows the sync state. Mentions of dates and people are written so that One reads them back exactly.
