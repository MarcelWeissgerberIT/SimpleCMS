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

For Tuesday, use worker **1.34.3 or newer** from One’s current download. This includes bounded Copilot format correction and execution receipts. Older feature-version notes indicate when a capability was introduced, not the recommended workshop build.

## Guided first start in ONE
Choose **Home → Your first start → Start step by step**. ONE shows one step at a time: worker, Copilot, Atlas including the company certificate, repository, and a suggested BA test task. **Check what is missing** explains the missing prerequisites and the next action. Copilot checks CLI sign-in and model availability only; the Atlas step actually reads your identity and the approved workshop record without a model request.

A certificate failure is not a rejected token. The local worker page offers EH-RootCA03 in this workshop for explicit trust confirmation. Fully restart the worker after changes, then retry. The BA test uses a personal project with one manual read-only stage followed by a mandatory review gate. **Prepare** starts nothing; **Start BA check now** runs the bounded task. A report with run evidence does not replace product acceptance. Account, workspace or worker changes require a new connection check. The complete illustrated reference remains under **Reference**.

## 1 · Workspace and access
Open the intended team workspace and check its name and your own role. Workshop guests normally read approved shared pages. An active temporary participation grant enables their own workers and tasks; invitations and administration remain blocked. A sign-in link does not establish Atlas rights or access to internal repositories. Check the Atlas tenant, actual project and your own agent separately. Never paste shared tokens into pages or chats; personal Atlas connections belong in **My secrets**.

## 2 · Worker and model
Tomorrow’s path is **Windows → Copilot first, Atlas Flow optional**. Check `node --version`, `git --version`, `copilot --version` and `$PSVersionTable.PSVersion`. The **Copilot CLI** is required; the VS Code extension alone is insufficient. GitHub requires **PowerShell 6 or newer** on Windows. The Angular demo requires Node **24.15 or newer**; C++ additionally needs a C++17 compiler.

If missing, install the CLI only with company approval: `winget install GitHub.Copilot` or `npm install -g @github/copilot`. Then run `copilot login` using your own account. The organization may need to enable CLI access. See the official [Windows prerequisites and installation](https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli). Do not bypass company policies or PowerShell safeguards.

Under **Settings → Coding worker → Cloud**, download your **personally paired** current worker **1.34.3 or newer** once. First-time setup shows two commands: **install**, then **run the fixed starter**. Use the starter afterwards; reconnecting downloads nothing. If the filename contains “(1)”, select the existing downloaded file in the installation section to get the correct command. Allow only the intended local repository. Copilot requires neither Claude nor a model API key in ONE.

On the local setup page press **Check CLI and login (no model request)**. Under **Settings → AI**, refresh worker models, then choose GitHub Copilot and an actually offered model under **This device → Default for everything** (`auto`, if offered). This persists on this device. Tasks and BA/coding/QA roles have independent choices. Credentials remain in the CLI, not in the workspace.

For Atlas, configure your own access under **Settings → AI → MCP servers → ATLAS → Details**. Model selection and a separate personal MCP permission switch now sit beside **Test connection**. Choose Copilot or Atlas Flow and explicitly allow MCP; choosing a model alone grants nothing. The check reads the tool catalogue. Then read one permitted record in tenant `one`. A personal Atlas sign-in link is not automatically an agent MCP token.

**Atlas Flow optional:** Select the shared workshop model; participants need neither Ollama nor a model key. Personal Atlas MCP calls need their own worker and Atlas access. Atlas Flow supports text/code suggestions, permitted ONE tools and MCP. Sharing inference does not provide a remote coding executor: repository pipelines use the selected engine on your own laptop. For the group comparison, transfer proposals into the demo repository and actually run its tests.

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
