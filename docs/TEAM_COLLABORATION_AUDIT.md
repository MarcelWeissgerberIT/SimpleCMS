# Team collaboration audit — 2026-11-08

The two-hour One maintenance session exercised real isolated team-server sessions with two people, disposable accounts and a dev mailbox. Provider/Atlas traffic was synthetic or blocked. Public verification used native backup import into an isolated local workspace, with no changes to the user's team workspace.

## Released changes

- Exact saved-work links and scoped overview state, readable current activity and guarded recovery (PR #17).
- Private tab-local code working copies; complete parallel copies for structured code proposals, analysis reports, source references and UI contracts; current access checks and reliable reconnect (PR #18).
- Refused mock writes retain pending input; asynchronous analysis respects source changes, role revocation and a colleague accepting a proposal (PR #19).
- Pending mock input stays visible after a version change and requires new targets; mobile invitation focus; first sign-in respects explicit choices (PR #20).

The cloud checks also covered private page/database/row isolation, private offline reconnect, direct/reusable/registration invitations, guest expiry, immediate role/member removal, notification recipients, task participation and budget visibility. Each release's exact source, CI, production hashes and live evidence are recorded in RUNTIME_RELEASES.md.

## Concurrent offline mock feedback — corrected

The audit on frontend `778f1d5d` confirmed that two offline additions converged to a single note because `designMock.attrs.spec` was one last-writer-wins attribute. The original observation remains in `artifacts/one-entry-live-20261108/offline-journal-audit.json`.

Generation 7 records immutable field operations in the page Y.Doc (`one:mock-edits:v1`), keyed by the Y element identity. Notes, version snapshots and proposals have independent stable identities; removed entries retain membership tombstones. A note-only change cannot roll back the active preview or another note's resolution/Markdown decision. Causal counters and operation IDs resolve concurrent writes to the same field deterministically; this is not a human conflict-review UI.

The ordinary `attrs.spec` remains a materialized JSON snapshot for the editor, server readers, native exports and history. Editable title children keep their usual text collaboration. Browser and server both materialize the shared log. Undo tracks the author's operations; referenced snapshots are retained by dependent note operations. A JSON import starts a new element log from the complete imported snapshot.

Creation limits (150 notes / 30 versions) still stop additional local creation. Reading no longer drops a whole valid journal when simultaneous additions exceed a creation limit. Pending older-generation copies are read directly during migration: additional notes/versions are recovered, current decisions win for existing IDs, and the current preview stays active. This cannot recover a note already lost from every stored copy before the fix.

`tests/e2e-cloud/mock-journal-audit.spec.ts` is now a passing regression covering both reconnect orders, reload, independent completion/MD decisions and Undo. Unit tests cover removal vs stale edits, preview replacement vs feedback, JSON import, child text, retained version references, old-copy recovery and capacity boundaries. Existing cloud collaboration and permission tests also pass. Older cloud writers must reload (server minimum and app generation 7).

The operation log is retained with the page; no unsafe log compaction or automatic external replay is performed. Concurrent conflicting edits to one field use deterministic last-writer semantics. Explicit page/history restoration remains an intentional content replacement.

## Other deliberate limits

Private code working copies live only in the current tab (maximum 50); save or download before reload/close. Pending mock text remains component-local and should be saved before navigation/removal. Parallel code-proposal checks apply to the current page, not a global repository lock. Live browser checks verify shipped UI behavior; they do not invoke real models or Atlas writes.
