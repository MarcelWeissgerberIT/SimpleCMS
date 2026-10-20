---
id: 2026-10-20-minimax-coding
date: 2026-10-20
order: 6
title: MiniMax in the coding pipeline
summary: Choose MiniMax M3.1 Flash for a task or a delivery role, with the same One and Atlas harness.
image: assets/shots/changelog/minimax-coding.webp
alt: Coding task with MiniMax API selected and the cloud data notice.
help: coding-pipeline, workorders
try: coding
---
**MiniMax · API** is now available in a task’s Type selector and separately for BA, coding and QA in work-order settings. It uses the common file tools, One task MCP, selected external MCP servers, task memory, loop limits and host verification.

Use worker **1.18.0** or newer. Open its setup page and enter your own MiniMax key. Choose a context budget from 65,536 to 1,000,000 tokens and a thinking effort. The default is 131,072 tokens / high. Saving settings makes no API request. The key stays in a private worker-side file; it is not synced into One.

This is a cloud API: selected code, prompts and tool results go to MiniMax. Costs are estimates from published token prices; uncertain responses retain a conservative reservation. Existing task/day budgets apply. Truncated or malformed calls do not execute tools, and no engine silently falls back to another provider.

An opt-in synthetic comparison is available with `node one-worker.mjs benchmark --agent minimax --limit 3 --budget 1` (USD). A live model-quality comparison still requires your key and actual runs; fixture tests only verify the integration.
