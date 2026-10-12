---
id: privacy
title: Where your data goes
section: privacy
order: 1
keywords: privacy, data, security, gdpr, dsgvo, local, browser, anthropic, openrouter, jev, typesafe, operators, google, vault, encryption, tracking, Datenschutz, Sicherheit, Daten, lokal
related: ai-data-rules, ai-providers, claude-key, gmail-sync, self-hosting, export
summary: What stays in your browser, what goes to your AI provider or Google — and when.
---
## Stays in your browser
Pages, databases, files, history, comments and settings of the local workspace live in this browser's IndexedDB. One has no account, no analytics and no tracking. getonecms.com only serves the app's files. Which pages you opened, and how often (Recent, Frequent), stays per device and per workspace — never synced, exported or sent. The [flight recorder](help:flight-recorder)'s tape (IndexedDB `one-recorder`) stays on this device too: ids, times and counts of every write, never page text or values — never synced, backed up or sent; **Reset workspace** deletes it.

## Leaves only when you use it
- **AI** (AI menu, terminal, ⌘K ask, autofill, meeting notes, Ask the help …): the text a request needs — the selection or page, the excerpts the AI reads, a transcript — goes to the provider of its route, with your key, and only the kinds of data your [data rules](help:ai-data-rules) allow there.
  - **Claude**: Requests go from this browser straight to Anthropic (api.anthropic.com), with your key. Anthropic does not train on API data. With MCP servers, Anthropic connects to them while Claude answers — their tokens go to Anthropic.
  - **OpenRouter**: Requests go from this browser to OpenRouter (openrouter.ai), which hands them to the operator of the model you picked. One names the operators you allow, switches OpenRouter’s fallbacks and account plugins off and, unless you switch it off, asks for operators that collect no data. OpenRouter keeps request metadata; your OpenRouter account settings apply on top. No MCP servers.
  - **Jev Router**: With the Jev Router, OpenRouter hands your request to Jev (TypeSafe), which picks one of the models in your list; that model’s operator answers. Both receive the request.
- **MCP servers** (Claude only): Anthropic connects to them with the token you gave, while Claude answers.
- **Gmail sync**: your browser talks to Google directly. Mail content goes to your AI provider only while **Organise with AI** is on — and only to a provider you switched your mail on for.
- **Meeting notes**: speech recognition is your browser's — Chrome sends the audio to Google, Edge to Microsoft, Safari may send it to Apple.
- **Webhooks and automations** go to the URLs you entered; **GitHub sync** to `api.github.com`.
- **Share links** carry the page inside the link — nothing is stored on a server.
- **Team workspaces** are stored on your team's server, encrypted at rest.

## Your keys — the vault
Your AI keys (one per provider), MCP tokens and the GitHub token are sealed with a key this browser created and cannot export. Settings only hold a marker (“•••• 1a2B”). Keys never appear in backups, exports, share links, sync or team documents. Without https (or localhost) a key works for the session only.

> **Reset workspace** (Workspace settings → Danger zone) deletes everything on this device — the vault included.
