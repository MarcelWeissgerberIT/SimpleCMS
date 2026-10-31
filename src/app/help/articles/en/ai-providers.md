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
The AI menu, ⌘K **?**, ask your workspace, transform, images and files, autofill, meeting notes, memory and the help's **Ask** can run on OpenRouter. The AI terminal and browser agents support Claude, Copilot and tool-capable local models. Model capabilities and data rules determine other available actions; MCP uses the personal connection described below.

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

Saving rules for worker providers makes an older One window ask for a reload. This keeps older windows from ignoring new provider and budget rules.

## Atlas Flow and MCP across text workflows

Worker 1.34.0 adds tool-capable local Ollama models to page questions, structured text actions, the AI terminal and browser agents. Set an agent override in **Agents → Edit → Model** or a workflow default in **Settings → AI → This device**. Models without verified function support remain text-only. This does not add image recognition.

**Set up Atlas:** Add and test your personal connection under **Settings → AI → MCP servers**. Permit MCP for **Local · Ollama** in your personal data rules. Your own paired worker is required for remote MCP calls. Also select Atlas and the necessary tools in each agent. Sharing a model never shares another person's Atlas account.

The harness discovers relevant tools, reads sources and stages changes for acceptance. ONE enforces scope; the team decides. Repeated identical calls stop, missing sources and context limits stay visible, and no cloud-AI fallback happens silently.

With a shared model, the host performs inference. ONE tools execute in your browser; Atlas MCP uses your personal worker. The host receives approved context and tool results, never tokens. Private pages, mail and personal memory are not shared automatically. Moving the model host to a controlled VM later keeps this separation and does not require publicly exposing Ollama.

## Analytik Jena · Direct start with Atlas Flow
At the top of **Settings → AI**, the dedicated **Atlas Flow · Frankfurt – our own model** card shows live status, the model and queue. Its availability check sends only a short test message without page or Atlas context. The card also opens your personal Atlas setup.

Prepared CNSx and FeliX team-workspace invite links lead straight to the start page. **Atlas Flow · Frankfurt** is already selected and the introductory tour offer is skipped.

1. Enter your **personal AJ-Atlas token** or personal AJ-Atlas link on the start plate. The workspace owner also starts with an empty input. Connections from other workspaces are not inherited.
2. **Connect and check Atlas** actually calls `atlas_whoami`. The token is encrypted on this device and forwarded through ONE to AJ-Atlas per request. The model server receives only permitted tool schemas and results, never your token.
3. When Frankfurt is ready, **Start first Atlas task** opens the AI terminal with a read-only briefing. It checks your identity, discovers matching projects, cites sources and suggests a small first task. It makes no Atlas changes.

This first Atlas task needs **no local worker, Copilot login or extra model API key**. Access to local repository files still needs your own paired worker. Personal settings outside this workspace stay intact. **Change token** replaces only this personal connection. Enter your token again on a new device.

An offline Frankfurt model keeps the first task disabled. There is no silent provider fallback. Model capabilities and your actual Atlas/ONE permissions still apply; this text model has no native image analysis or image generation.
