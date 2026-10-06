---
id: export
title: Export & backup
section: share
order: 3
keywords: export, backup, download, markdown, html, json, pdf, print, restore, Export, Backup, Sicherung, herunterladen, wiederherstellen
related: import, publish-site, privacy, sync
summary: Markdown, a web page, a print document, a full backup — or a whole website.
---
**Export** in the Page options **•••**, ⌘K → *Export*, or **Workspace settings → Data → Export workspace**. Pick the **Scope** (this page or the whole workspace) and a **Format**:

- **Markdown folder** — folders, pages as `.md`, databases as CSV. Re-importable here and into Notion.
- **Web page** — one styled, self-contained HTML file with images inlined.
- **Full backup** — everything including files, as `.json`. Restore it with **Import**.
- **Print document** — a print-ready reading view: choose *Save as PDF* in the print dialog.
- **Website** — a static site (see [Publish a website](help:publish-site)).

## Restore a backup
**Import** → drop the `.json` file → choose:
- **Merge into this workspace** — keeps everything; adds missing pages; where both have a page, the newer version wins.
- **Replace workspace** — deletes the current pages and databases and restores the backup exactly.

> Your workspace lives in this browser. A regular **Full backup** is the safest copy. Your Claude key and tokens are never in a backup.
