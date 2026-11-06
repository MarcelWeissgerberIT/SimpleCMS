---
id: team-cloud
title: Team workspaces
section: team
order: 1
keywords: team, cloud, server, collaborate, workspace, switch workspace, personal space, sign in, magic link, live, presence, price, pricing, cost, Team, Cloud, Workspace wechseln, zusammenarbeiten, Preis
related: invites, members-roles, self-hosting, public-api
summary: With a One server, teams edit live together. Every account starts with a space of its own.
---
The local workspace needs no server. For a team you connect to a **One server** — self-hosted today (see [Self-hosting & encryption](help:self-hosting)); on getonecms.com the workspace menu says *Team cloud — coming soon* and links the self-hosting guide.

## What it costs
- **Local** (this browser): free.
- **Self-hosted** (your own server): free — a donation is welcome, never required.
- **The hosted team cloud**: $99 per user per year. It is in development: there is no sign-up yet.

## Sign in
On your team's server, sign in with your email: One sends a one-time link — no password. At the first sign-in the server creates **your own space** (“*Name*’s space”): a workspace only you are in. Workspaces you are invited to appear next to it.

## Switch workspaces
Click the workspace name at the top of the sidebar: **This browser (local)**, your team workspaces, **New team workspace…**, **Sign out**. A new team workspace can **Start empty** or **Copy my local workspace** (pages, databases, content and files; the local one stays as it is).

## Working together
- Everyone edits live: presence and cursors show who is where.
- Offline? Your changes stay on the device and sync when the connection is back.
- Comments, mentions and assignments reach people's **Inbox**. A [task](help:tasks)'s reminder rings for its people (for every member when nobody is assigned).
- Two people changing the same field at once (a task's people, its status): the last change wins for that field.
- A tab running an older version of One can only read in a shared workspace until it reloads (**Reload to keep editing**) — it never removes what a newer version wrote.
- Your Claude key, MCP servers and sync settings stay per person and device — they are never shared with the team.

## Deliberately check out locally
On an up-to-date team server, press **Cloud · Live** in the top bar or **Check out locally…** in the workspace menu. Read and acknowledge the warning. One creates a separate local workspace and downloads its attachments, keeping the starting version on this device for comparison. The team's cloud workspace remains available.

The **grey crossed-out cloud · Local · Checked out** and the banner identify this detached copy. Its content does not synchronize automatically, even when you are online again. A temporarily disconnected cloud workspace, in contrast, still synchronizes automatically when its connection returns.

**Compare with cloud…** reads the current cloud version and shows Base, Cloud and Local side by side, with changed lines highlighted. Independent fields merge together. If both sides changed the same field or rich text, choose **Keep cloud** or **Use local**. Rich text is compared as one whole document; prepare a combination of both versions in your local page before comparing again. Removing a page while the other side edits it is a conflict too.

Only **Merge selected changes** writes the reviewed result. If the cloud changes after the comparison, the whole merge stops: **Compare again**. Current write permissions and page locks still apply. One also refreshes the local copy with the approved result, provided no new unreviewed local edits arrived during the request. Its updated checkpoint prevents decided conflicts from being proposed again. **Open cloud workspace** shows the shared result. Resetting the local copy removes its checkout binding and never becomes a request to delete cloud content.

Content checkout covers shared pages, database structure, rows, comments and files. It does not merge Private pages, personal settings, connections, agents, permissions or automation configuration. New local attachments must upload successfully before a merge. A copy belongs to this browser and its original server address and remains locally after sign-out. Use your own device profile and back up important local work. A checkout supports up to 5,000 pages; a merge request up to 16 MiB of JSON. Files follow the server's upload limits.
