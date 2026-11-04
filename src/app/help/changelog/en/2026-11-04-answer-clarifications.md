---
id: 2026-11-04-answer-clarifications
date: 2026-11-04
order: 1
title: Answer clarification questions directly
summary: Page AI waits for human answers; closed questions can be prepared again.
---

When page AI asks a necessary clarification, the request now stays open. **Bind answer and continue** passes your answer to that same run. The source, question and bound answer remain associated.

If an older run has ended or ONE was reloaded, choose **Prepare answer as a new request**. Your answer and the original task are prepared in the terminal. Only Start sends a new request. The AI must check current sources and existing results again; earlier reads and approvals are not reused.

Waiting questions are checkpointed with their run on this device. Reloading never starts a request automatically. Accepted Atlas writes must not be blindly repeated.
