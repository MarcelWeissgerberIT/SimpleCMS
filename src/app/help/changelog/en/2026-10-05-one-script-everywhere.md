---
id: 2026-10-05-one-script-everywhere
date: 2026-10-05
order: 1
title: One Script everywhere — commands, buttons, Gmail, Claude
summary: Run your scripts from a database's commands, a button, an automation or ⌘K; send mail through Gmail; let Claude write queries and scripts for you.
image: assets/shots/changelog/one-script-everywhere.webp
alt: A query in the script editor, and on the right "Ask Claude" with a request and Claude's checked draft — three rows now, Use this
help: one-script, database-commands, buttons, mcp-bridge
---
Your scripts now run where you work:

- **Database commands** — *Edit commands… → Add command → Run script*. With rows selected on the database page it runs once per row (`page.current` is the row).
- **Buttons** — the action *Run a script*, or type `/script` for a button bound to one. **Automations** — *Run script* for the row that changed. **⌘K** — *Run script: <name>* for the open page.
- **Gmail** — when it is connected, `mail.send` sends from your account (the list before the run says *via Gmail*); Google asks once for permission to send.

**Ask Claude** sits on top of the query builder and the reference: describe what you want, Claude drafts the code, One checks it before you see it — **Use this** puts it in. In the AI terminal Claude answers questions across databases with a read-only query and drafts scripts for your review; with the One MCP, Claude Desktop or Code can run a query or one of your saved scripts — always after you approved its dry run. See [One Script](help:one-script).
