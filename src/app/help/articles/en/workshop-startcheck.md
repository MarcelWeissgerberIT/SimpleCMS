---
id: workshop-startcheck
title: Workshop · Participant laptop start check
section: ai
order: 23
keywords: workshop, copilot, windows, atlas, internal git, simulation, c++, angular, participant, test, evidence
related: workshop-startampel, copilot-coding, coding-harness, personal-secrets, custom-agents, team-cloud
summary: Check accounts, the worker, the internal checkout and Atlas before the first real task.
---
Run this check on the computer that can access the internal repository. A successful organizer test proves neither access inside the company network nor the quality of the eventual solution. Each person's credentials remain personal; workspace packages contain no personal connections.

## 1 · Workspace and access
Open the intended team workspace and check its name and your own role. Workshop guests can read approved shared pages; editing, inviting and agent/coding execution remain blocked. A sign-in link does not establish Atlas rights or access to internal repositories. Check the Atlas tenant, actual project and your own agent separately. Never paste shared tokens into pages or chats; personal Atlas connections belong in **My secrets**.

## 2 · Worker and model
Download the current worker and start it on the same laptop. Worker **1.26.0** includes Copilot text, tools and conditional media support. Connect under **Settings → Coding worker**; with multiple workspaces, verify explicit permission for this workspace. On Windows use the downloads and shortcuts shown for that platform.

For GitHub Copilot, install CLI **1.0.102** or newer, run `copilot login` and approve authentication yourself. On the local setup page press **Check CLI and login (no model request)**. Use only offered models; a Free account may expose only `auto`. The desktop app and CLI may have different entitlement requirements. This check buys no subscription and sends no project prompt.

Refresh worker models under **Settings → AI**. Choose a provider and model for the individual request; allow page, file and MCP access separately. A pipeline task's coding-agent choice is independent of the default for browser agents and text actions.

## 3 · Internal checkout and simulation
Register the existing local checkout in the worker. It may use internal Git; no copy to an external repository is needed. Agree the exact working branch, build command, test command and simulation with the team. Run those commands manually first. An empty or example check is not project evidence.

A cloud model receives approved source excerpts and tool results even when Git stays internal. Confirm the applicable company access before the first real task. A purely synthetic text check can run independently of the customer's repository.

## 4 · Three small connection tests
1. **Text:** Ask for an explanation of a synthetic function bug. Record provider, model, response and reported tokens; Copilot subscription costs remain unknown to One.
2. **Atlas:** Read exactly one approved record in the intended tenant/project through your personal connection. Record identity, record and time. No unrequested write test or automatically executed send tool.
3. **Coding:** Run a small approved task with a verifiable criterion in the task branch. Review its diff and execute the agreed real test. Record only actual results.

Images need account-advertised vision. Copilot handles PDFs as locally extracted text, without diagrams or layout; scans need another explicitly chosen path. A text test does not establish image capability.

## 5 · Evidence and recovery
Collect the brief, sources, report, diff and test command in One. Link the requirement, domain decision, open risks and test evidence in Atlas. Evidence names the date, person, commit/branch, environment, command, expected result and actual result. **Not run** remains visible; **passed** requires a real run.

If the network, model access, repository or Atlas permission is missing, stop the run and record the cause and next responsible person. Practice the flow with an explicitly synthetic exercise; do not treat it as acceptance of the real product. Human review and integration remain the team's responsibility.

Record personal progress in the [start checklist](../workshop-startampel/): mark green only after an actual check. A saved access link is not sufficient.
