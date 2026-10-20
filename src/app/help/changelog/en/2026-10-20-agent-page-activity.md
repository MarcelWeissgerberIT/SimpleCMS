---
id: 2026-10-20-agent-page-activity
date: 2026-10-20
order: 3
title: Agents on the page and a model default
summary: See who is working, save findings to the page and choose browser-agent models in Patchbay.
image: assets/shots/changelog/agent-page-activity.webp
alt: Agents on the page and a model default
help: custom-agents, patchbay
try: agents
---
Pages now show targeted agent assignments and actual browser-agent reads, with status, initial model and latest step. After success, save findings through a dialog prefilled with the source page. Existing content and report provenance stay intact.

Patchbay now has a default model for browser agents on this device. An agent’s explicit model wins; a running assignment keeps its initial model. Current browser agents use Claude; Coding and server agents keep their own settings. Help explains the scope and behavior.
