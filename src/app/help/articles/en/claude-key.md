---
id: claude-key
title: Your Claude key
section: ai
order: 1
keywords: claude, api key, anthropic, sk-ant, key, model, opus, sonnet, haiku, byok, vault, cost, Schlüssel, API-Schlüssel, Modell
related: ai-menu, privacy, anthropic-unreachable, mcp-servers
summary: AI in One runs on your own Anthropic API key — stored encrypted in this browser.
---
One has no AI subscription: you bring your own key, and Anthropic bills the usage to your account.

1. Create a key in the Anthropic console (**console.anthropic.com → Settings → API keys**). It starts with `sk-ant-`.
2. In One: **Settings → Claude AI → Anthropic API key**, paste it. Or press <kbd>Space</kbd> on an empty line — the AI menu asks for it.
3. **Test key** checks it. The status reads **Connected · key verified**.
4. Pick a **Model**: Claude Opus 5.5 (most capable, default), Sonnet 5.5 (balanced) or Haiku 4.5 (fastest). The model label in the AI menu switches it too.

## Where the key lives
The key is sealed in this browser's vault with a key the browser created and cannot export. It is sent only to `api.anthropic.com` — never in backups, exports, share links, sync or team documents. On another device (or another browser) you add it again.

## No key yet?
The AI menu offers **Try a demo answer (no key)**: canned answers, written offline, nothing is sent.

> Revoke or rotate keys in the Anthropic console. Removing the key in Settings deletes the sealed copy from this browser.
