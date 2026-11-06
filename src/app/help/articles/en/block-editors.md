---
id: block-editors
title: Editors and changes in a section
section: team
order: 25
keywords: collaboration, author, editor, attribution, block, shared, toggle, changes, section
related: team-cloud
summary: Show contributor names once per section and inspect their recorded changes together.
---
Open a shared page in a server workspace, then **Page options (…) → Show block editors**. Names appear once per section rather than after each keystroke or on each block. A heading starts a section; content before it belongs to the initial area. A page without headings is one area. Unknown or unresolvable editors produce no plate and no extra spacing.

**Click a name** to see all recorded contributions by that person in the selected section. The panel initially shows only added and removed text, grouped by affected area. Consecutive edits by the same person are combined; a different writer starts a separate contribution, so their changes are never credited to the first writer. **Show before and after** reveals context and formatting. More areas can be loaded; the view is not limited to the last contribution. The page content remains intact rather than being split into new blocks.

The server records comparisons from this feature's deployment onwards. Previously, only the editor and timestamp were stored. Those names open an explanation instead of an invented historical comparison. Deleted content remains in recorded comparisons while its section exists; a deleted section no longer has a name to click on the current page. Reverted edits may leave no remaining change in a combined contribution.

The switch is **always optional**. Turning it off removes all name bars and the panel. It is remembered in this browser and does not change anyone else's view. It controls display; the server continues recording new contributions for the shared change view. Readers, including guests, can inspect the view. Recorded comparisons are visible to current readers of the same page; keep personal credentials in **My Secrets**.

The server uses the authenticated account. Browser AI edits show the applying account. Timestamps are server receipt times, including offline changes sent later. Translated views show source changes. Live cursors instead show who is present or typing now.

Local workspaces, Private pages and public share pages do not display this feature. Private page documents do not record new content comparisons. Workspace export files omit this view; complete server backups preserve the shared comparisons. The server needs `block-authors:1`, and `block-changes:1` for content comparisons.
