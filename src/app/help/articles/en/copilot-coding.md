---
id: copilot-coding
title: GitHub Copilot in One
section: ai
order: 22
keywords: copilot, github, enterprise, internal git, windows, c++, angular, subscription, atlas, model
related: coding-pipeline, coding-harness, personal-secrets, mcp-servers
summary: Use your local Copilot CLI login for One’s AI actions, browser agents and coding harness.
---
Choose **GitHub Copilot** as a task's **Coding agent**, or pin it for a work-order role. Worker **1.25.0** or newer is required; older workers cannot silently substitute Claude. The worker also exposes Copilot as an AI provider for One. Coding tasks keep their own engine choice; workspace features use the common provider/model picker and AI rules. Signing in does not change your defaults or grant access to workspace data.

## Set up on the participant computer
Install GitHub Copilot CLI **1.0.102** or newer on the same computer as the One worker, then sign in locally with `copilot login`. The account must have a suitable Copilot entitlement and organization permission for the CLI and chosen model. An IDE subscription alone is not evidence that this works. `COPILOT_BIN` can point to a CLI outside PATH, including on Windows.

Open **Copilot setup** from the coding task or the worker's local setup page. **Check CLI and login (no model request)** checks the installed CLI, login and available model catalog; it starts no coding task and sends no page/repository prompt. Choose an available exact model ID, or leave `auto` when the account offers it. Copilot Free can also support a small text test through this path; the desktop app may require a different entitlement. The CLI check and your account are authoritative, rather than app sign-in alone. **Save Copilot model** saves only this preference in the worker's private `copilot.json`. `ONE_COPILOT_MODEL` overrides it. A pinned model unavailable to the account is refused; One does not switch silently.

Credentials remain in Copilot CLI's own authentication or its supported environment variables, such as `COPILOT_GITHUB_TOKEN`. Do not paste tokens into task text or the model field. One neither exports these credentials nor saves them in the workspace.

## Internal Git, Atlas and execution
The existing local checkout may point to internal Git. It does not need to be copied to external Git: the worker creates a task worktree and uses the existing repository access on that computer. The local build and simulation commands must work there; configure the repository's actual analysis/test command. Selected source excerpts and tool results still go to the Copilot service under the organization's rules. Internal repository hosting alone does not keep model context on the laptop.

One owns the execution loop: bounded task context, memory, source reads, guarded edits, configured checks and completion evidence. Copilot supplies the next structured harness response over its local SDK protocol. Native Copilot tools, repository configuration discovery, file hooks, skills, cross-session store and remote session export are disabled. The model cannot gain a shell by requesting one. Planning/doc stages receive read-only tools; implementation can edit source and run only configured checks. Git commit, push and integration remain explicit pipeline stages.

For a personal Atlas agent, select its dedicated connection and exact permitted tools through **My secrets** on the task. The worker's task-scoped MCP proxy handles that connection; Copilot receives tool schemas and scrubbed results, never the Atlas token. Read-only stages expose only read-only Atlas tools. No Claude installation is required for this path. The profile, selected tenant and Atlas's server-side permissions remain separate responsibilities.

## Limits and workshop check
Copilot subscription usage is **not a USD receipt**. One does not report it as free and cannot enforce dollar limits against that tariff. Stage step/time limits, repeated-action detection and configured checks remain active. The initial harness context budget is 32,768 tokens; bounded retrieval and task memory apply rather than claiming the model's maximum context. It is a conservative harness budget, not a model specification.

Before relying on the live exercise, run a small real task using the participant's own login and approved network: read the intended Atlas record, plan a change, implement in the branch, execute simulation/tests and link actual evidence. Check the available model and enterprise restrictions on that computer. Successful local automated tests of One are not proof of access inside the customer's network or a guarantee of generated code quality.

## Use Copilot across One
Open **Settings → AI → Models on the worker**, refresh the list, and check that your signed-in Copilot models appear. Allow only the data classes you intend to send to **GitHub Copilot**; personal data and MCP need their own device permissions. No Copilot API key belongs in One. The provider control before the model lets you choose Copilot for just one request, or save it as this workspace/device’s default. A custom browser agent can pin its own Copilot model.

| Area | Supported path |
| --- | --- |
| Writing, questions, workspace search and help | Common provider/model selection |
| Database transformation, autofill, translations, meeting summaries, memory proposals, script drafts and work-order planning | Text or schema-validated JSON; malformed output is rejected before changes are applied |
| AI terminal and browser agents | One runs its existing scoped tools and stages proposals for the existing review/apply flow |
| Atlas and other selected remote MCP servers | One’s worker connects using the selected credentials; schemas and scrubbed tool results reach Copilot, tokens do not |
| Coding pipeline | Shared coding harness, configured tests, explicit Git stages |
| Pictures | Worker 1.26.0 or newer and account-advertised vision; selected images as in-memory attachments, at most four / 3 MiB total, within stricter model limits |
| PDFs | Worker 1.26.0 or newer extracts text locally, at most 100 pages / 120,000 characters; no images, diagrams, layout or OCR; scans and clipped documents are refused before inference |
| Native PDF visual inspection, image generation and Jev decisions | Not supported by this Copilot transport; choose a capable provider explicitly |
| Unattended team-server agents while your browser/worker is offline | Not provided by the personal Copilot connection |

Browser MCP connections use the servers selected in **Settings → AI / Agents · MCP** and the agent’s exact tool allow-list. Integration OUT/send tools stay disabled. The worker accepts only selected public HTTPS connections, no launch commands or extra headers. Stopping, closing the connection or switching workspaces aborts active worker requests. No repository files are read by text requests; a workspace tool reads only the allowed One content. Changing terminal providers starts the next task with fresh model context; earlier proposals stay available for review. Follow-up tasks with the same provider retain their conversation. Finish a limited run with its original provider, or send a fresh task after switching. Images are offered only when the account actually advertises vision. PDF answers refer solely to locally extracted text; the dialog discloses omitted figures and layout. A Free catalog containing only `auto` grants no additional image capability.

Browser requests use at most 65,536 context tokens when the CLI reports enough capacity, otherwise a conservative 32,768-token budget; tool descriptions are shortened and MCP schemas are retrieved by search. Loops stop on tool/round limits, repeated calls, cancellation or missing context. Per-response usage is recorded when available, with unknown monetary cost rather than a fabricated zero. Dollar budgets cannot meter a Copilot subscription. A real account/model/network test is still required on each workshop laptop.

## Start the workshop ready to work
The [workshop start check](help:workshop-startcheck) covers accounts, the worker, internal Git, a model test, Atlas and test evidence. Each participant uses their own credentials. A successful test on the organizer’s computer does not replace a test on the participant laptop.
