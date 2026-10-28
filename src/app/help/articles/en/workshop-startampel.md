---
id: workshop-startampel
title: Workshop start check
section: ai
order: 24
keywords: workshop, readiness, participants, worker, copilot, atlas, guest, setup
related: workshop-startcheck, copilot-coding, personal-secrets, team-cloud
summary: Check personal setup together and keep blockers visible.
---
Open **Startampel · Workshop readiness** in the shared workshop. When automatic tracking is configured, ONE matches rows using the signed-in account and the private recipient list; display names alone are insufficient. Each person has an expandable plate with five indicators: ONE access, Atlas read, Worker, Copilot, and repository/test path. Gallery shows plates; Table shows the same ordinary rows.

ONE automatically records successful events: sign-in to the correct ONE workspace and a server-registered worker connection; a recognized `atlas_get` read from a configured workshop project through the personal ONE session; a successful Copilot model request or coding step; and an actual repository test with exit code 0. Atlas, model and test receipts are reported by the executing device, not independently certified by the server.

An Atlas login in another tab, stored token, tool discovery or installed app does not count as an MCP read or model result. After a recognized Atlas read ONE updates the tracker and dismisses the personal welcome reminder.

**Open** means not yet checked. Choose **Ready** only after the real personal check works. **Blocked** identifies an actual obstacle. Overall readiness is derived from required steps: a blocker wins; every required step must be Ready. Not needed cannot substitute for a required check.

Guests only require ONE and Atlas read access. They do not require a worker, coding, or repository access to observe the workshop. Later users are excluded from the workshop readiness denominator. This planning role changes no membership or permissions.

Automatic receipts show the source and timestamp for each step. This is not a continuous online monitor: “Worker last connected” is a timestamped successful connection check. Manual blockers remain explicit holds. Manual values remain possible and are labelled accordingly.

Expand a plate to record the cause, next step, responsible person, and a minimal note. The last manual change records a timestamp and name. Never enter tokens, personal access links, or internal raw logs. Keep personal credentials in **My Secrets**.

The tracker establishes no Atlas connection, performs no additional connection or model tests, and sends no invitation. It records observed successful steps; ONE sign-in is attributed to the actual authenticated server session. A stored Atlas link or installed Copilot app is not proof of a successful read or CLI request. End-to-end acceptance requires its own evidence.

Team members edit within existing workspace permissions; guests can only read. Ordinary database rows remain in workspace exports. Older ONE versions can show the data as a normal gallery/table.

## Setup and current connection
The five setup checks retain their source and time. The worker version is recorded when reported by the device. A separate connection label says “connected now”, “disconnected now” or “check again”. It uses authenticated participant events and the cloud relay observation, updates about every 30 seconds while ONE is visible and becomes stale after 90 seconds without observation. Closed tabs and lost network therefore cannot leave permanent green online evidence. Manual holds remain in place. The display probes no other accounts and starts no model.


Guests with active temporary participation need all five checks too: ONE, Atlas, worker, Copilot and repository. The tracker reads the actual grant from the team server; the planning role remains Guest. After expiry, technical checks become not needed again and previous evidence is preserved. An unknown grant status does not prematurely waive technical checks.
