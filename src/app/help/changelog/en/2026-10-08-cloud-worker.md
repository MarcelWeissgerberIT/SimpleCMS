---
id: 2026-10-08-cloud-worker
date: 2026-10-08
order: 7
title: The coding worker on any computer — through your team server
summary: In a team workspace, Settings → Coding worker → Local | Cloud lets the worker run on a build server or a VM; it connects out to the One server, which only passes on messages sealed between this browser and the worker.
image: assets/shots/changelog/cloud-worker.webp
alt: Settings → Coding worker in a team workspace — Where the worker runs set to Cloud, the cloud worker downloaded, and below the status Connected · build-box · 1 repo · via cloud
help: coding-pipeline, team-cloud
try: settings-coding
---
**Local or Cloud.** In a team workspace on a One server, **Settings → Coding worker → Where the worker runs** now offers **Local | Cloud**. With **Cloud** the worker runs on any computer — a build server, a VM, the desktop at the office — and connects out to your One server: no port to open, no VPN.

**Three steps.** Download **one-worker-cloud.mjs** (it carries a token only for you and only for this workspace), copy it to that computer and start it there with `node one-worker-cloud.mjs`, then tick the repositories on that computer. The card reads *Connected · build-box · 1 repo · via cloud*, and tasks run as with a local worker.

**Sealed end to end.** Every message between this browser and the worker is encrypted with a key only the two of them hold — from this download. The server passes the sealed boxes on: it cannot read or change task text, code, diffs or logs, and keeps none of them. **Revoke** stops the worker for good.

> Tip: tasks are handed out from an open tab — keep One open in this browser while they should run. Cloud needs the One server on `https://`; in a local workspace the option stays greyed out with the reason. More: [Coding pipeline](help:coding-pipeline).
