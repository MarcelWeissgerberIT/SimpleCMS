---
id: 2026-11-01-stability
date: 2026-11-01
order: 7
help: mcp-servers
title: More reliable from Atlas source to acceptance
summary: Smaller tool catalogues, specific repair guidance and saved source-handoff receipts.
---
Small-context Copilot now discovers ONE tools as needed. Atlas failures get a relevant repair card; missing permissions stay distinct from a rejected token. Identity checks and tool discovery do not replace a project query. Contradictory claims about empty results or unverified persistence are checked before display.

Direct source handoffs remember already-attempted identical writes on this device across reloads. Inspect Atlas first after a lost response. The receipt stores hashes and the actual reference, no access tokens or source text. This is not a cross-device exactly-once guarantee. The exact call remains limited to 20,000 characters; larger original sources stay complete in ONE.
