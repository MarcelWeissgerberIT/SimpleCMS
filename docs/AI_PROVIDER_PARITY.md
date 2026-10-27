# Provider parity — workshop verification, 27 October 2026

ONE shares page/table editing, proposals, task handoffs and review semantics across supported routes. Capability checks remain authoritative: a configured model is not automatically a vision, tool or decision model.

| Path | Claude API | Copilot CLI | Tool-capable local model | OpenRouter | Codex / MiniMax / Ollama Cloud text route |
|---|---|---|---|---|---|
| Text questions and writing | Yes | Yes | Yes | Yes | Yes |
| Selected existing table cells, reviewed apply | Yes | Yes | Yes | Yes | Yes |
| ONE terminal tools, custom browser agents | Yes | Yes | Yes | Not currently routed | Not currently routed |
| Personal Atlas in ONE terminal | Connector | Own paired worker | Own paired worker | Not currently supported | Not supported by the text route |
| Coding and task handoffs | Worker | Worker | Worker | No dedicated coding engine | Worker engines support their selected capabilities |
| Configured personal Atlas read grant in a coding task | Yes | Yes | Yes | — | Yes, for available worker coding engines |
| Images/PDF | Model capability | Advertised vision / local PDF extraction | No native image route currently | Catalogue capability | Text-only route |
| USD receipt | Reported/catalogue | Unknown subscription cost | Local inference 0; hosting cost separate | Reported/catalogue | Provider-specific; unknown stays unknown |

OpenAI's direct API destination remains unavailable in this build; it must not be offered as a functioning alternative. Copilot can offer OpenAI-family models under its own account catalogue. These are separate routes.

## Corrected handoff path

The explicit Atlas setup press clears only this provider's device MCP restriction, preserves workspace forbids, verifies identity without inference, stores the personal token sealed, and clears an old rejection marker after success. A completed welcome reminder can be reopened from the first-start guide without exposing another recipient's access.

All worker coding agents display the personal-connection selector. A checked configured Atlas connection grants only whoami/search/get/context to that task, account, workspace, provider and paired worker for the session. The provider receives MCP-result consent explicitly on this press; other private classes remain closed. Agent/worker changes require confirmation again. Tokens never enter shared tasks or model prompts. Handing a task to another person does not hand over credentials. The separate passphrase vault remains available for explicitly selected additional tools.

The Copilot loop fits only real linked tool results to its conservative wire budget, marks excerpts, preserves original visible history and never removes the person's task or changes tool arguments. An explicitly addressed MCP request with denied MCP data permission stops before inference rather than returning a page-only substitute.

## Verification scope

Automated browser fixtures exercise provider selection, shared text/table actions, reviews and conflicts, Copilot workspace tools, media handling, Atlas discovery, task creation and actual worker handoff payloads. Transport fixtures check schemas, denied writes, credential redaction and partial MCP failures. Cloud tests check personal activation, isolated accounts and the guest path. Tests do not contact billable models.

A live personal MCP check confirmed Richard's EH Atlas identity and tool discovery. This does not certify a Windows laptop's corporate network/certificate configuration or model response quality. Those require the user's actual worker run.
