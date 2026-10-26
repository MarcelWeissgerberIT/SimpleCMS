
# Candidate-bound checks in the coding worker

Available from worker 1.33.0.

Test receipts fingerprint HEAD and Git-visible file bytes before/after execution (SHA-256, file count, Node/worker versions). Guided final acceptance requires a stable candidate. Ignored artifacts, installed dependencies and external services are excluded; unreadable/submodule/oversize trees remain unknown. Bounds are 25,000 files, 128 MiB/file, 512 MiB total and bounded read time. This is snapshot evidence, not OS isolation or continuous monitoring.

The protected repository setup offers **Counterexample challenge · optional** (`challengeCommand`: argv array, not shell text). Final delivery QA runs it once after review, against the candidate checked by the existing test command. Prefer owner-maintained verification outside the editable worktree. A modified candidate or unavailable command blocks acceptance; real failures use only the already-approved repair budget. An absent command is reported as `not_configured`. Automatic repair protects existing check entrypoints. The owner's command is still an ordinary process, not a sandboxed service.

`check_finding` / `one_task_check_finding` accept optional declared version/scope/authority `context` and a `decisionPin`: a blocking question, separating example, two options with different expected outcomes, and an acceptance check. Observed quotations can support the draft; semantic conflict, source authority and human decision remain unverified/open. No tool adds an approval or writes a decision to Atlas.

New stage receipts record executor, requested model when known, elapsed time, reported turns and known costs. Unknown usage/cost stays null. After human acceptance, ONE can save a manually curated Procedure with the delivery's evidence marker in One memory; transfer to another task must still be checked. No autonomous rule learning or extra agent swarm is enabled.
