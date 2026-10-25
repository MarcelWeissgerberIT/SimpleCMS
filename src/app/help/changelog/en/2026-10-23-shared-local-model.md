---
id: 2026-10-23-shared-local-model
order: 1
help: coding-harness
date: 2026-10-23
title: A local model for your workspace
summary: Explicit sharing, encrypted text requests and a bounded queue.
---
Worker **1.29.0** can offer one local model to members of one cloud workspace. **Settings → AI → Share a local model** provides selection, availability, queue status and a stop-sharing control. Restarting cannot reactivate a disabled share.

Participants select its entry under **Local · Ollama** for text actions. One request runs at a time; guests are excluded. Repository access, tools and personal Atlas tokens are not shared. This first channel supports reviews and code proposals. The new `compare-demo` CLI compares two small synthetic C++/TypeScript exercises with Copilot using identical inputs and unchanged tests.
