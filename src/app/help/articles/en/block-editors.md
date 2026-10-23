---
id: block-editors
title: Who edited this block?
section: team
order: 25
keywords: collaboration, author, editor, attribution, block, shared, toggle
related: team-cloud
summary: Show the last synchronising account beside each block in a cloud document.
---
Open a page in a cloud workspace, then **Page options (…) → Show block editors**. Small plates above the blocks show their last editor. Hover a plate for its timestamp. Readers can use the switch too. The switch is remembered in this browser; it does not change the page, another person's view or workspace exports.

ONE already shows live participants and cursors. These identify who is present or typing now. Block plates identify the account whose content change reached the server last. Lists, tables and other container blocks have one plate for the whole container. Editing nested content updates that container's plate. Moving an unchanged block within the page preserves its author.

The server records the authenticated account, not a name supplied with the text. Browser AI edits show the account that applied them. A server/API write may show a generic account if no member name is available. An unavailable or ambiguous author is shown as **Not recorded**. Existing blocks do not receive an invented historical author when opened.

The timestamp is when the server received the change, including changes sent after offline editing. Concurrent edits converge with the shared document; this is a last-change indicator, not tracked changes or a complete audit history. Deleting a block also removes its current plate. Translated views show the author of the source block, not a translator.

Only changes received after the feature was deployed are newly recorded. Local workspaces, public share pages and exported files do not show these plates. The server must support `block-authors:1`.
