---
id: 2026-11-01-compiled-programs
date: 2026-11-01
order: 2
title: Save compiled programs and repeat with fresh inputs
summary: Fixed tool steps, immutable versions and an individual receipt for each run.
image: assets/shots/changelog/compiled-programs.webp
alt: Personal program library showing a version, hash and fixed tool and decision steps.
help: agent
try: terminal
---
In the AI terminal, **Programs** opens your personal library. After a successful task, save its actual tool sequence as a reviewable executable draft. Editing the definition creates a new version.

Each start uses the same saved artifact with fresh inputs. Sources and access are checked again; the decision cube asks prerequisite questions afresh. AI can generate content inside fixed steps without selecting extra tools. Repeating a program does not guarantee identical wording or domain correctness.

**Run receipts** links the version and artifact hash to each unique run ID, model selection, step result hashes and answer or error. ONE changes remain proposals for review. External effects are visible before starting; after a partial write, inspect the actual state before repeating it.
