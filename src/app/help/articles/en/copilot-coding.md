---
id: copilot-coding
title: GitHub Copilot in the coding worker
section: ai
order: 22
keywords: copilot, github, enterprise, internal git, windows, c++, angular, subscription, atlas, model
related: coding-pipeline, coding-harness, personal-secrets, mcp-servers
summary: Use a local Copilot CLI login as the model transport for One's coding harness.
---
Choose **GitHub Copilot** as a task's **Coding agent**, or pin it for a work-order role. Worker **1.24.0** or newer is required; older workers cannot silently substitute Claude. This connection is for coding, planning and document stages in the worker. Browser agents and the AI terminal keep their own provider settings; a Copilot license does not automatically configure them.

## Set up on the participant computer
Install GitHub Copilot CLI **1.0.102** or newer on the same computer as the One worker, then sign in locally with `copilot auth login`. The account must have a suitable Copilot entitlement and organization permission for the CLI and chosen model. An IDE subscription alone is not evidence that this works. `COPILOT_BIN` can point to a CLI outside PATH, including on Windows.

Open **Copilot setup** from the coding task or the worker's local setup page. **Check CLI and login (no model request)** checks the installed CLI, login and available model catalog; it starts no coding task and sends no page/repository prompt. Choose an available exact model ID or leave `auto` for Copilot's account default. **Save Copilot model** saves only this preference in the worker's private `copilot.json`. `ONE_COPILOT_MODEL` overrides it. A pinned model unavailable to the account is refused; One does not switch silently.

Credentials remain in Copilot CLI's own authentication or its supported environment variables, such as `COPILOT_GITHUB_TOKEN`. Do not paste tokens into task text or the model field. One neither exports these credentials nor saves them in the workspace.

## Internal Git, Atlas and execution
The existing local checkout may point to internal Git. It does not need to be copied to external Git: the worker creates a task worktree and uses the existing repository access on that computer. The local build and simulation commands must work there; configure the repository's actual analysis/test command. Selected source excerpts and tool results still go to the Copilot service under the organization's rules. Internal repository hosting alone does not keep model context on the laptop.

One owns the execution loop: bounded task context, memory, source reads, guarded edits, configured checks and completion evidence. Copilot supplies the next structured harness response over its local SDK protocol. Native Copilot tools, repository configuration discovery, file hooks, skills, cross-session store and remote session export are disabled. The model cannot gain a shell by requesting one. Planning/doc stages receive read-only tools; implementation can edit source and run only configured checks. Git commit, push and integration remain explicit pipeline stages.

For a personal Atlas agent, select its dedicated connection and exact permitted tools through **My secrets** on the task. The worker's task-scoped MCP proxy handles that connection; Copilot receives tool schemas and scrubbed results, never the Atlas token. Read-only stages expose only read-only Atlas tools. No Claude installation is required for this path. The profile, selected tenant and Atlas's server-side permissions remain separate responsibilities.

## Limits and workshop check
Copilot subscription usage is **not a USD receipt**. One does not report it as free and cannot enforce dollar limits against that tariff. Stage step/time limits, repeated-action detection and configured checks remain active. The initial harness context budget is 32,768 tokens; bounded retrieval and task memory apply rather than claiming the model's maximum context. It is a conservative harness budget, not a model specification.

Before relying on the live exercise, run a small real task using the participant's own login and approved network: read the intended Atlas record, plan a change, implement in the branch, execute simulation/tests and link actual evidence. Check the available model and enterprise restrictions on that computer. Successful local automated tests of One are not proof of access inside the customer's network or a guarantee of generated code quality.
