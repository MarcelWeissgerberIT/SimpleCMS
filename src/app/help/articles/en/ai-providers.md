---
id: ai-providers
title: AI providers — Claude, OpenRouter, the Jev Router
section: ai
order: 0
keywords: ai, provider, providers, set up ai, setup, claude, anthropic, openrouter, openai, jev, jev router, typesafe, key, keys, connect account, models, fast, standard, deep, router, combine, routing, default, this device, KI einrichten, Anbieter, Schlüssel, Modelle, kombinieren
related: ai-data-rules, ai-costs, claude-key, ai-unreachable, privacy
summary: Set up AI once — Claude, OpenRouter or both — and decide which one answers which kind of work on this device.
---
One has no AI subscription: each provider gets **your own key**, and that provider bills what you use. You can set up several and combine them.

## Set up AI
Open the assistant from **Settings → AI → Set up AI…**, from ⌘K **Set up AI**, or from any card that says AI isn't set up yet. Six steps; what you confirm with <kbd>Enter</kbd> is kept, even if you close the assistant early.

1. **Provider** — switch on the providers you want. **Claude** (Anthropic) runs everything in One, MCP servers included. **OpenRouter** gives one key for hundreds of models from many makers — some very cheap — but no MCP servers. **OpenAI** follows with a later update.
2. **Key & check** — for OpenRouter, **Connect account** asks you at OpenRouter whether One may get a key (you copy nothing and can set a spending limit right there), or paste a key. For Claude, paste a key from the Anthropic console (it starts with `sk-ant-`). The **free check** asks only for the provider's model list or the key's limit — no text is sent. A key is sealed only once it passes.
3. **Models** — three roles per provider: **Fast** (many small jobs), **Standard** (writing, reshaping, questions) and **Deep** (long tasks). For OpenRouter One suggests models; **Change** opens the catalogue with its prices, what each model can do and its operators.
4. **Data & limits** — what may go to which provider. A new provider starts with nothing. See [Data rules](help:ai-data-rules).
5. **Working together** — who answers what on this device: leave it as it is, everything via Claude, **one provider for everything** (its standard model, bulk work, the help and memory on its fast one) or your own choice in Settings.
6. **Done** — a summary, **Undo** for step 05 and **Test on a page**.

## The Jev Router
With at least two models in your OpenRouter list, **Jev Router** (by TypeSafe, via OpenRouter) can take a role: it picks the right model of your list for each request and forwards it there. You pay per request; the price is reported with the answer, and One reserves the most expensive model of your list beforehand. Jev reads the request to choose.

## Jev as a pre-checker
The **Pre-checker** row of step 03 starts **Off**. **Choose Jev 1.13** lets Jev (a decision model by TypeSafe) answer four fixed questions about every proposal of an agent whose section 06 switches the pre-check on — it marks or holds back, it never writes. See [Jev as a pre-checker](help:ai-jev).

## What runs where in this version
The AI menu, ⌘K **?**, ask your workspace, transform, images and files, autofill, meeting notes, memory and the help's **Ask** can run on OpenRouter. The AI terminal, agents, scripts, Outbox drafts and anything with MCP servers run on Claude for now — their cards say so.

## Settings → AI
One plate per provider: its state, **Check (free)**, **Change key**, **Remove …** (only the key, or the key and this device's rules for it, with Undo). Below: **This device** — a default and one row per kind of work — the data lines, your own data, today's usage and the MCP servers.

> Keys are sealed in this browser's vault, per provider — never synced, never in backups or exports. Another device asks for them again.

## Ollama Cloud for coding

Open **Settings → AI → Ollama Cloud → Set up API key and model…**. The same card is in **Coding worker** settings. It opens the worker’s protected setup page. Enter your key there once and save; all coding tasks using Ollama Cloud on that worker share the saved key and model. If the worker is offline, the card opens its connection settings first. One never reads or synchronizes this key. Opening settings and saving send no model request; **Test connection (cloud request)** is a separate action. This does not change the AI terminal or browser-agent provider.

## Choose provider before model

The AI menu, palette questions (**Mod+K → ?**) and **Help → Ask** show a separate provider control before the model. Choosing an available provider selects its first usable route for this request and opens that provider’s model list. Choose a specific model there. The ordinary model button or **Alt+M** searches across providers; **Models from provider** narrows the list. Choosing sends no request and changes no default. **Default on this device** restores the configured route; the explicit default buttons still save device rules. Missing keys, data rules and required capabilities can disable a provider or model. With a connected worker version 1.21 or newer, local Ollama models, Ollama Cloud, MiniMax and Codex also support text requests here. Load models and explicitly configure data rules in **Settings → AI → Models on the worker**. Credentials remain on the worker. Images, PDFs and structured tool runs still require a capable model; Coding keeps its own agent selection.


## Worker models and costs

The provider list separates names from availability. Blocked entries explain why and link to setup. Models include locally installed Ollama models, Ollama’s cloud catalogue, the configured MiniMax model and the Codex CLI’s cached models. Actual model access depends on the account and is checked when sending. **Local** means inference on the paired worker; a cloud worker is outside your Mac. Ollama cloud aliases are refused as local inference.

**Cost display** applies EUR/USD to all metered providers. The rate and date are shown; stored costs and limits remain USD. **Price unknown** means no individual price and never free. MiniMax is estimated from token prices; Ollama Cloud and Codex can use plan quotas. A USD budget limit can block requests with an unknown price.
