---
id: offline-mock-feedback
date: 2026-11-08
order: 2
title: Keep both people's offline mock feedback
summary: Separate notes and review decisions survive reconnecting and reloading.
image: assets/shots/changelog/offline-mock-feedback.png
alt: Two separately created offline notes remain visible, with an independently queued Markdown change.
help: agent
try: terminal
---

When two people save notes on the same mock while disconnected, both notes now remain after reconnecting and reloading. Completing a note and queuing a design-system Markdown change are saved independently.

Feedback keeps its original preview reference even when a colleague changes the active mock. Undo takes back your own operations while preserving another person's later notes. Explicitly removed entries are not brought back by a stale text edit.

Reload an older One tab to keep editing after this update. Previously saved mocks remain readable; native backups contain their complete current journal. Notes already lost from every stored copy before this fix cannot be reconstructed automatically.
