---
id: 2026-10-21-workspace-checkout
date: 2026-10-21
order: 1
title: Check out locally, merge deliberately
summary: A separate local copy, a three-way comparison and explicit conflict decisions before returning content to the cloud.
image: assets/shots/changelog/workspace-checkout.webp
alt: A detached workspace comparing its base, cloud and local versions, with a title conflict awaiting a decision.
help: team-cloud, workspace
---
Press **Cloud · Live → Check out and open locally** after acknowledging the warning. Shared pages, database structure, rows, comments and attachments become a separate local copy. A grey crossed-out cloud and a banner show that it does not synchronize automatically.

**Compare with cloud…** shows Base, Cloud and Local. Independent fields combine; conflicting edits require **Keep cloud** or **Use local**. Rich text is compared as a whole document. The server checks the reviewed version again before merging; a newer cloud edit stops the whole batch and asks you to compare again.

Private pages, keys, connections, agents and automation configuration stay outside the content merge. Your existing preferences remain intact. See [Team workspaces](help:team-cloud) for copy limits, checkpoints and sign-out behavior.
