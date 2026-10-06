---
id: reload
title: “Could not be displayed” & updates
section: trouble
order: 1
keywords: error, could not be displayed, fault, reload, broken, crash, blank, updated, new version, outdated, Fehler, neu laden, kaputt, Störung
related: offline-app, export, anthropic-unreachable
summary: A part of the page shows an error or “One was updated…” — almost always a reload fixes it.
---
## What you may see
- **Database could not be displayed** — with a **Reload** button, where a database should be.
- **This panel hit a fault.** — with **Try again** and **Reload app**.
- **One was updated while this tab was open. Reload to use Claude.**
- **A new version of One is ready.** — with **Reload**.
- **Diagram unavailable offline**.

## Why
One loads some parts only when you first need them (database views, charts, diagrams, Claude). When a new version goes live while your tab stays open — or the home-screen app is only resumed — the old tab may ask for a part that is no longer on the server.

## Fix
1. Click **Reload** (or reload the tab). One saves your work first; nothing is lost.
2. Still there? Close every One tab and open One again.
3. Offline? Some parts need one online visit after an update — connect and reload.

## If an error stays
Try **Try again** on the panel. Export a **Full backup** (**Workspace settings → Data → Export workspace**) to be safe, then report the problem with the error text on [GitHub](https://github.com/MarcelWeissgerberIT/SimpleCMS/issues).
