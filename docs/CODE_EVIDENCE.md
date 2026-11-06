# Atlas source code references

A One page can hold a pinned source reference instead of copied code. Insert **Source code reference / Quellcode-Beleg** from the slash menu (`/quellcode`), then paste the complete `citation` returned by Atlas `atlas_code_read` and add a finding. Existing JSON code blocks containing a valid citation offer **Show as source reference / Als Quellbeleg anzeigen**.

The portable representation is a regular fenced code block with language `atlas-code` and JSON containing `citation` (all six fields unchanged), optional `server` (personal MCP connection name), `repoName`, `finding`, `highlight: [firstLine, lastLine]` within the citation, and `atlasUrl` only when Atlas supplied the actual source URL. Ordinary Markdown edits, export and older clients preserve this representation; no new document schema is required. No source bytes or credentials are stored by the viewer.

**Open code** reads only after an explicit click. A pinned connection must still exist; otherwise the person chooses a connection, with no silent substitution. The viewer uses the existing personal MCP transport, restricted to `atlas_code_repos`, `atlas_code_verify` and `atlas_code_read`, respecting connection restrictions, data-flow policy and Atlas's existing repository permission/model-processing gate. The prepared AJ-Atlas cloud connection needs neither a local worker nor an LLM invocation. Other connections use their established transport.

Atlas verifies the original citation before reading. The returned snapshot, commit, path, digest, range and text line count must match. Optional context widens the range by up to 30 lines on each side within the 2,000-line bound; that expanded citation is verified separately. Truncated and mismatched results are refused. Highlighting uses the source's absolute line numbers, with syntax colouring and a jump back to the finding. Verification authenticates the source citation, not the finding's interpretation.

Source content is held only in the open viewer. Closing, cancellation, changing the reference, connection, workspace or access scope discards it and aborts pending work. Static shared documents show the reference but cannot load code unless the referenced page is available in the current workspace and the person has their own permitted connection. No repository execution, edit, import or Atlas write is offered.

The Atlas code-analysis template and current MCP tool guidance describe this output format so requested analyses can create source cards directly. Previously saved skill versions retain their pinned instructions; select and save a new template version to replace those instructions explicitly.

## Request evidence for a passage

Select text in the editor and choose **Quellcode-Belege nachfordern / Request
source-code evidence** (file/search icon). The dialog retains the selected passage
and its source page, with optional repository and version fields. It prepares an
unstarted terminal task. The normal model route, permissions and metering apply
when the user presses Start. Existing terminal drafts/runs are never overwritten;
reference overflow and selections above 8,000 characters are reported, not silently
truncated. Workspace changes close the pending request.

The task requires repository/version discovery, modelProcessing permission,
read-only code reads and citation verification, and reports supporting,
contradicting, partial or absent evidence. Results use the existing atlas-code
cards. The passage is not automatically rewritten. This is an investigation
instruction for the existing reviewed terminal, not a new autonomous worker.
