---
id: connected-review-workflows
date: 2026-11-08
order: 10
title: Connect findings, mock feedback and sources
summary: Linked finding cards, source-version checks and reusable quality checks.
help: agent
---

Code-analysis findings can now link requirements, an exact mock marking and your review note. **Prepare focused recheck** creates a bounded analysis request for you to start. Open the saved mock marking directly from its finding.

Under **Evidence**, compare the saved snapshot with the current Atlas catalogue without a model call. A different snapshot means review is needed; it does not prove a code defect. Mock design-source checks are also retained. Find these checks under **Work overview → Recheck sources**.

Mock comparison includes feedback outside the current request and lists all detected changes for each note. Under **Notes**, assess the current version as fulfilled, partially fulfilled or open. Partial and open feedback can be revised again; the semantic assessment is yours.

**Before starting** lets you add or remove sources from the actual starting context. Existing history and permitted subsequent tool reads remain available. Saved work shows retained steps and draft before resuming and keeps its original source page.

Under **Work overview → Reuse**, prepare four quality checks: mocks against design rules, requirements against code evidence, evidence quality, and change scope. Select source pages and save the workflow. Each run reads the documents afresh and confirms scope. Document review does not replace executed tests or live code investigation.
