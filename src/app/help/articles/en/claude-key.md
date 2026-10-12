---
id: claude-key
title: Your Claude key
section: ai
order: 2
keywords: claude, api key, anthropic, sk-ant, key, model, opus, sonnet, haiku, byok, vault, cost, set up ai, Schlüssel, API-Schlüssel, Modell
related: ai-providers, ai-menu, privacy, ai-unreachable
summary: Claude runs on your own key from the Anthropic console — set it up in the assistant, sealed in this browser.
---
One has no AI subscription: you bring your own key, and Anthropic bills the usage to your account. Claude is one of the [AI providers](help:ai-providers) One can use — the one that runs everything, MCP servers included.

1. Create a key in the Anthropic console (**console.anthropic.com → Settings → API keys**). It starts with `sk-ant-`.
2. In One: **Settings → AI → Set up Claude** (or ⌘K **Set up AI**, or the card any AI feature shows without a key). Paste the key in step 02 — the free check asks only for the model list, no text is sent — and it is sealed.
3. Step 03 shows Claude's roles. **Standard** is the model this device sends every Claude request to — change it there (open the assistant again from **Settings → AI** to change it later). **Fast** and **Deep** are kept for the routing of a later version; until then, the model chip in the AI menu picks another Claude model for one request.

## Where the key lives
The key is sealed in this browser's vault with a key the browser created and cannot export. It is sent only to `api.anthropic.com` — never in backups, exports, share links, sync or team documents. On another device (or another browser) you add it again.

## No key yet?
The AI menu offers **Try a demo answer (no key)**: canned answers, written offline, nothing is sent.

> Revoke or rotate keys in the Anthropic console. **Settings → AI → Remove …** deletes the sealed copy from this browser.
