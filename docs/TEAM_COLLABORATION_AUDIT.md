# Team collaboration audit — 2026-11-08

The two-hour One maintenance session exercised real isolated team-server sessions with two people, disposable accounts and a dev mailbox. Provider/Atlas traffic was synthetic or blocked. Public verification used native backup import into an isolated local workspace, with no changes to the user's team workspace.

## Released changes

- Exact saved-work links and scoped overview state, readable current activity and guarded recovery (PR #17).
- Private tab-local code working copies; complete parallel copies for structured code proposals, analysis reports, source references and UI contracts; current access checks and reliable reconnect (PR #18).
- Refused mock writes retain pending input; asynchronous analysis respects source changes, role revocation and a colleague accepting a proposal (PR #19).
- Pending mock input stays visible after a version change and requires new targets; mobile invitation focus; first sign-in respects explicit choices (PR #20).

The cloud checks also covered private page/database/row isolation, private offline reconnect, direct/reusable/registration invitations, guest expiry, immediate role/member removal, notification recipients, task participation and budget visibility. Each release's exact source, CI, production hashes and live evidence are recorded in RUNTIME_RELEASES.md.

## Confirmed remaining defect: concurrent offline mock journal edits

Reproduction on frontend `778f1d5d`:

1. Two members open the same saved mock.
2. Both browsers disconnect.
3. Each saves a different feedback note; each sees its own note locally.
4. Both reconnect and their documents converge.
5. Both now see only one note. The other successfully displayed local note is absent from the shared journal.

The observed run retained the owner's note and lost the reviewer's note. The winning writer is not a contract. Evidence is `artifacts/one-entry-live-20261108/offline-journal-audit.json` in the maintenance workspace. `tests/e2e-cloud/mock-journal-audit.spec.ts` is an **expected failure**, with the desired assertion that both notes survive; it is not a passed data-retention check.

Cause: `designMock.attrs.spec.journal` is one structured value. Concurrent disconnected replacements converge through last-writer-wins semantics. The safe whole-node replacement used by structured code blocks cannot simply be copied here: the mock also has editable child content and independently changing previews, versions, proposals and assessments.

Next implementation needs independently mergeable journal entries keyed by stable IDs, explicit tombstones for removals, independent assessment updates, version-reference retention and a backward-compatible migration. Validate concurrent append/resolve/remove, concurrent preview acceptance and note creation, title editing, reconnect in both orders, reload, duplicate IDs, access loss, export/import and old-client behavior. Retrying a whole journal or automatically unioning all attributes risks resurrecting deletions or overwriting accepted decisions.

Until that change, avoid editing the same mock journal from multiple disconnected sessions. Online composition and preservation of pending text are verified, but do not imply conflict-safe concurrent journal storage.

## Other deliberate limits

Private code working copies live only in the current tab (maximum 50); save or download before reload/close. Pending mock text remains component-local and should be saved before navigation/removal. Parallel code-proposal checks apply to the current page, not a global repository lock. Live browser checks verify shipped UI behavior; they do not invoke real models or Atlas writes.
