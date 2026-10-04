---
id: privacy
title: Where your data goes
section: privacy
order: 1
keywords: privacy, data, security, gdpr, dsgvo, local, browser, anthropic, google, vault, encryption, tracking, Datenschutz, Sicherheit, Daten, lokal
related: claude-key, gmail-sync, self-hosting, export
summary: What stays in your browser, what goes to Anthropic or Google — and when.
---
## Stays in your browser
Pages, databases, files, history, comments and settings of the local workspace live in this browser's IndexedDB. One has no account, no analytics and no tracking. getonecms.com only serves the app's files.

## Leaves only when you use it
- **Claude** (AI menu, agent, ⌘K ask, autofill, meeting notes, Ask the help): the text the request needs goes to Anthropic (`api.anthropic.com`) with your key — the selection or page, the excerpts Claude reads, a transcript.
- **MCP servers**: Anthropic connects to them with the token you gave, while Claude answers.
- **Gmail sync**: your browser talks to Google directly. Mail content goes to Anthropic only while **Organise with Claude** is on.
- **Meeting notes**: speech recognition is your browser's — Chrome sends the audio to Google, Edge to Microsoft, Safari may send it to Apple.
- **Webhooks and automations** go to the URLs you entered; **GitHub sync** to `api.github.com`.
- **Share links** carry the page inside the link — nothing is stored on a server.
- **Team workspaces** are stored on your team's server, encrypted at rest.

## Your keys — the vault
The Claude key, MCP tokens and the GitHub token are sealed with a key this browser created and cannot export. Settings only hold a marker (“•••• 1a2B”). Keys never appear in backups, exports, share links, sync or team documents. Without https (or localhost) a key works for the session only.

> **Reset workspace** (Settings → Data) deletes everything on this device — the vault included.
