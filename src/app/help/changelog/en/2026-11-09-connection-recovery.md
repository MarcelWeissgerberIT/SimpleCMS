---
id: 2026-11-09-connection-recovery
date: 2026-11-09
order: 2
title: Recover from a short server interruption
summary: Run receipts retry briefly while model calls stay stopped.
image: assets/shots/changelog/connection-recovery.webp
alt: A stopped terminal request with a saved receipt and connection guidance.
help: agent
try: terminal
---
When One returns a temporary gateway error, the terminal explains the interruption. It does not automatically repeat the model request.

Saving the same private run receipt retries twice after short delays for HTTP 502, 503 or 504. This only saves the existing record; it does not rerun tools or inference. If saving still fails, keep the tab open and use **Save receipt again**.

Document analysis now explicitly marks the end of each page. Reads beyond that end explain the invalid position while retaining earlier successful reads. Tool errors include their reason in the log, and One execution names the selected model instead of a local worker.
