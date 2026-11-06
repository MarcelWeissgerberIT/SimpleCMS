---
id: 2026-11-06-code-changes
date: 2026-11-06
order: 1
title: Review small code changes in One
summary: Turn a finding into a scoped proposal, compare the lines and hand the accepted version to Atlas.
image: assets/shots/changelog/code-changes.webp
alt: A small UI change with original code, editable replacement and highlighted line differences.
help: agent, pipelines
try: slash
---
Choose **Create change** on a code-analysis finding. Select up to three source ranges from the same snapshot and explicitly load them into the page. Edit the replacement yourself or ask your One model for a proposal.

Compare the changed lines and save revisions. **Verify sources and accept proposal** checks the pinned source again. Acceptance keeps the proposal in One; build and tests have not run.

Save the accepted proposal in Atlas or download the change package. When the Atlas administrator has configured a GitLab destination, One displays its project and target branch. A separate button creates a branch and draft merge request. Merging and CI stay in GitLab; Atlas snapshots remain unchanged until a subsequent import.
