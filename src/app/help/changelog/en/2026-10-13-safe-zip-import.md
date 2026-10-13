---
id: 2026-10-13-safe-zip-import
date: 2026-10-13
order: 1
title: Coding worker 1.8.1 — safe ZIP import, own settings only for your own repos
summary: Download the worker again and restart it — a ZIP import can no longer bring a git folder or run anything, and Claude Code starts without the own settings of repos the worker cloned or imported (a switch per repo).
image: assets/shots/changelog/safe-zip-import.webp
alt: The worker's setup page — the note that this version marked legacy-shop as code from elsewhere with Got it, the keys Clone from GitLab / GitHub and Import a ZIP, and the repo legacy-shop from ~/one-repos with the MCP server kb, the hint that only user-scope servers reach it, and the switch Use this repo's own Claude Code settings off, "imported by the worker from a ZIP".
help: legacy-modernisation, coding-pipeline
try: settings-coding
---
**Download it again and restart it.** **Settings → Coding worker → Download again**, stop the running worker (<kbd>Ctrl+C</kbd>) and start the new file. **#/coding** names a worker older than 1.8.1, with a key to the download.

**A ZIP brings code, nothing else.** Disks on macOS and Windows ignore case, so a ZIP could carry a `.GIT` folder that git took as the repository's own — and its settings could run a program while the worker imported it. Now every spelling of `.git` is left out, a ZIP that is a repository itself is refused, and the import runs no hooks, filters, gc or fsmonitor. In an imported repository your own git drivers (filters, diff and merge drivers) stay off.

**Own settings only for your own repos.** Claude Code loads a repository's own settings as it starts — `.claude/` with its hooks, `.mcp.json`, `CLAUDE.md` — even in a stage that only reads. On a repository the worker cloned or imported it now starts without them. The worker's setup page (**Change repositories**) has the switch **Use this repo's own Claude Code settings** per repository, with the reason it is off; switch it on only for code you trust. Your own repositories stay as they were. MCP servers for such a repository: add them with `claude mcp add -s user …`. What an older worker cloned or imported is marked once — the setup page names it until you press **Got it**.

**Imported a ZIP from someone else before?** If an older worker imported it on macOS or Windows, check that repository: `git config --local --list` should show no `core.fsmonitor`, `core.hooksPath`, `filter.*` or `gpg.program` you did not set, and `.git/hooks` should hold only `*.sample` files — or delete it and import the ZIP again. More: [Modernise legacy code](help:legacy-modernisation).
