---
id: 2026-11-04-atlas-connection-stability
date: 2026-11-04
order: 1
title: Clearer Atlas access and dependable mock handoff
summary: Check Atlas without an AI call, keep cancelled logins cancelled, and see which mock files were saved.
image: assets/shots/changelog/atlas-connection-stability.webp
alt: Verified personal Atlas access with a separate explanation and next step for missing model setup.
help: mcp-servers
try: settings-mcp
---

**Test connection** now checks Atlas directly when the prepared cloud connection or a connected worker is available. You do not need a model for this check. The start page shows your verified Atlas access separately from any remaining model setup.

Cancelling or signing out also discards late sign-in answers. A delayed check cannot mark a changed connection as ready. Slow email sign-in requests explain what is happening and remind you to check your inbox before requesting another link.

Large design sources keep their source handles when the model context is shortened. Free-form mocks still need no requirement record. Once a checked mock is ready, ONE can finish without an extra model summary. A failed correction stops with its original tool result available for inspection.

When attaching a mock to Atlas, ONE shows source checking, uploading and the number of confirmed files. An interrupted upload keeps its receipts and is not repeated automatically. Changing your personal connection during the handoff stops further writes.

Other MCP connections can also be found by their name. Identically named tools remain bound to their own connection. Tools explicitly declared as read-only can be used in the task flow; actual inputs are still checked against the current tool schema.
