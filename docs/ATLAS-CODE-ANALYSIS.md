# Atlas code analysis in One

Open **AI terminal → Skills → Template: Atlas code analysis**, save a version and add it to the request. The portable method uses the workspace's personal Atlas connection. Repository IDs, tenant, branches and snapshots are discovered from actual responses, not embedded in the public application. No analysis, database or external write runs when the template is selected.

The method covers narrow code reads, snapshot comparison, citation verification and requested storage in a Code-Analysen database. Each stored analysis keeps the full citation JSON (`repo`, `snapshot`, `commit`, `path`, `lines`, `digest`) with the verification time. Native One console tool names and deferred tool discovery are used. The existing change-review mode still applies. Code-derived Atlas requirements remain drafts for a human to review in Atlas.

## Host behavior

The eight repository read tools have explicit read effects; `atlas_code_propose` is a write. Code review, repository import/update and model-switch mutations are blocked on the agent path. Every code operation except repository listing checks a fresh, permitted `atlas_code_repos` result before execution and again before releasing the result. Pagination is followed with loop detection and a 100-page bound. Unknown or disabled `modelProcessing` fails closed. A result withheld after a proposal does not claim the proposal was never executed. No write is retried automatically.

The cloud Atlas bridge and the local worker enforce the policy. The browser also checks local-worker calls for compatibility with older installations. These checks add metadata requests; code reads themselves are not repeated. Code-tool responses do not use the 30-second task read cache. Previously transmitted context cannot be recalled from a provider; use a fresh task after changing access or model-processing settings. The model switch is checked across separate MCP calls, not in one Atlas database transaction.

Code tools currently have no per-call tenant argument. The method checks repository tenant metadata and avoids silently changing token-wide tenant selection. A different selected tenant may make a repository inaccessible; it does not prove the repository is absent.

Skills have local, theme-aware SVG thumbnails with document, alignment, code-evidence and mock motifs. They use One's existing color tokens, make no network requests and do not upload private skill text. The labels remain the accessible names.

## Validation

Unit coverage checks effects, pagination, denied/missing metadata, revocation, complete citation receipts and skill import. Cloud bridge tests verify refusal before code execution and human-only actions. Browser tests cover saving/selecting the template, provider payloads with allowed/disabled code, and light/dark layouts on desktop and mobile. Mock area regression is included because its browser geometry and comparison helpers were moved out of the shared Node-compatible model.

## Readable terminal activity

MCP rows show the operation, observed repository name, branch/short commit, file, line range and search term. Names come from successful responses in the current task, scoped by connection and repository; no additional lookups are sent. Unknown names stay generic. Exact identifiers and bounded parameters remain under Technical details. Existing receipt-backed code rows can show their file and range even without the newer display metadata.

A fixed Current activity strip shows up to three executing calls while the log scrolls. Between tool calls it reports processing results, streaming an answer, or waiting for a decision. It does not estimate progress or invent model reasoning. Retained-source reads keep their source label during the same task and remain explicitly marked as retained reads. The change affects display only, not tool dispatch, source permissions or provider payloads.
