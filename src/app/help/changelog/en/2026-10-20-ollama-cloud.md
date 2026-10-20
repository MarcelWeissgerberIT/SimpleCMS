---
id: 2026-10-20-ollama-cloud
date: 2026-10-20
order: 4
title: Ollama Cloud with your own key
summary: Choose an Ollama cloud model for coding and keep its key in your local worker.
image: assets/shots/changelog/ollama-cloud.webp
alt: Coding task with Ollama Cloud selected and its cloud data notice.
help: coding-pipeline, agent
try: coding
---
Choose **Ollama Cloud** in a coding task’s Type selector or for BA, coding and QA in a work order. The shared One / Atlas harness supplies context, task memory, tools and host checks.

With worker **1.19.0** or newer, open **Ollama Cloud setup**. Enter your Ollama API key in the password field and choose a cloud model by its API name (initially `minimax-m3.1-flash`). Saving makes no model request. **Test connection** sends a small cloud request with the saved settings.

The key stays in a private worker file, outside the synchronized workspace. Selected source and tool results go to Ollama. Ollama plan quotas apply; One cannot measure or enforce dollar budgets for this subscription tariff. Stage step limits, permissions and checks still apply. Local Ollama remains a separate choice.

The AI terminal also labels long page reads **Part 1 of 4**, **Part 2 of 4**, and so on. The count follows actual text sections, so repeated reads are easier to distinguish.
