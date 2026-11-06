---
id: 2026-11-06-analysis-source-check
date: 2026-11-06
order: 1
title: Document analysis uses the required sources
summary: A connected Atlas account no longer forces an extra read in every document stage.
image: assets/shots/changelog/analysis-source-check.webp
alt: Document pipeline waiting for approval, with source reads listed in the log.
help: pipelines
try: coding
---
One can derive a specification from the task and its saved One documents. An available Atlas connection alone no longer makes a fresh Atlas read mandatory in every stage. Required source reads and explicit review rules still apply.

The log now names the One pages read in that stage and counts Atlas reads. If a required read is missing, the task shows a clear explanation and keeps the completed documents. **Retry** continues the failed stage; approval gates remain in place.

Internal block IDs added by the editor no longer count as a source edit. Changes to the content still stop the run.
