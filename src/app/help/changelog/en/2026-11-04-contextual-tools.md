---
id: 2026-11-04-contextual-tools
date: 2026-11-04
order: 3
title: Use tools with the selected context
summary: Codewords, selected passages or a page with subpages – specific actions and focused questions.
---

A configured codeword such as `atlas:` selects its connection. It does not prescribe a workflow or a particular function. The AI discovers the functions actually available and uses the current request and its source context.

For example, select a decision and type **`atlas:insert comment`** or **`atlas:update record`**. The selection travels as a reference. Alternatively, choose **This page and subpages** in the context selector. The AI can then read relevant descendants through actual page references; each page's access and context rules still apply.

When the action is clear, it can run through the available tools. If the destination, content or meaning remains unclear, the AI should ask about that specific detail. Your answer is bound to the running task. The previous automatic Atlas create/update/comment picker is removed.

A comment request does not authorize a different write operation. A content update with an explicitly unchanged ticket status cannot change that status. Permissions, data rules, source checks and effect verification remain active. A codeword grants no additional rights. You still need to review the result for factual correctness.

Work on ONE pages still needs no Atlas record. You can request a later transfer separately.
