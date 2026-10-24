---
id: 2026-10-24-workshop-evidence
date: 2026-10-24
title: Keep workshop evidence together
order: 1
summary: Bounded Copilot format correction, current worker connection and verified Atlas storage.
image: assets/shots/changelog/workshop-evidence.png
alt: Guided order with an evidence packet and explicit workspace destination; simulated example.
help: workorders
---
Worker **1.30.0** corrects a malformed Copilot answer at most once within the same session and deadline. Usage and correction counts remain in the receipt. Unavailable tools or login/transport failures still stop execution.

The start check separates retained setup observations from the current worker connection. It shows reported versions and marks connection observations for rechecking after 90 seconds.

At closure, download a JSON packet or explicitly choose a shared destination page. Actually started tests report their command, commit if known, Git state, platform and timing. Older receipts are not backfilled or presented as freshly checked.

The Atlas handoff starts as a draft. After approved storage, readback confirms the actual record, project and exact ONE-EVIDENCE marker. Domain decisions remain with the team. Already shared evidence receives a visible Atlas addendum.
