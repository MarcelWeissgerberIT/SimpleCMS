---
id: welcome-emails
title: Welcome emails and personal Atlas start
section: team
order: 9
keywords: workshop, welcome, atlas, token, link, invitation, bulk, import, guests, start
related: invites, personal-secrets, workshop-startcheck, members-roles
summary: Prepare recipients privately, assign personal links and explicitly release the emails yourself.
---
Under **Workspace → People → Welcome emails**, admins can prepare their own private draft. It contains recipients, email addresses, destination workspaces, roles, personal Atlas links and optional separate Atlas agent tokens. Other admins cannot see this draft. It is neither workspace content nor model context and is excluded from workspace exports.

Recipients initially appear as compact plate cards showing name, email, destination workspace, access and status. Click a card to expand its fields, then click again to collapse. **Expand all** and **Collapse all** control the whole list. Collapsing preserves your inputs. The indicators distinguish “Atlas link ready”, “Access token detected in link” and “Separate MCP token stored”. They confirm presence, not validity or a successful connection test. Detection remains visible below the link field after encrypted saving; a blank field retains the stored value. New recipients open directly for editing.

## Paste names, links and tokens together
Add recipients first or correct the prepared addresses. Under **Paste names, links and tokens together**, use a full name or email followed by these fields:

```text
Max Example
Link: https://atlas.example/invite?token=EXAMPLE
Token: SEPARATE-AGENT-TOKEN
```

A single `Name | Link: … | Token: …` row also works. Parsing runs locally without an AI request; German umlauts and ae/oe/ue are matched. First names alone, conflicting links, unknown names and ambiguous matches need correction. Separate credentials are also extracted directly from `MCP-Token: …`, `Agent-Token: …`, `Agenten-Token: …`, `API-Key: …` and `Authorization: Bearer …`. A value may appear on the next line; quotes and inline backticks are removed. Bearer credentials are stored without the prefix. A URL token is never interpreted as an MCP agent token; an invitation link alone cannot supply a separate MCP token. An import with errors is withheld in full. After matching, review recipients and destinations, then press **Save encrypted**. Input values are hidden again; blank fields retain saved values.

## Sending requires your click
**Manual sending not before** blocks sending until the chosen time, including on the server. No automatic send timer runs. Saving and previewing send nothing and create no invitations. Preview hides personal links. Confirm recipients and roles, then press **Send welcome emails**.

Team members receive their team workspace. Guests can observe the same workspace with **Guest · read only** access. They appear as guests under **People** or on their pending invitation. They see shared pages and live updates, but cannot edit content, start agents that make changes or invite other people. Other people’s private pages and secrets remain inaccessible. Readable content can be copied. A separate destination workspace remains optional. Each email includes an address-bound ONE invitation, the personal Atlas link and the first task. Existing members get a direct workspace link instead. Separate MCP tokens are never included in the email. ONE invitations last seven days; the Atlas link has its own expiry and must still work for the workshop.

**Accepted by mail server** means SMTP accepted the message, rather than confirming inbox delivery. Ambiguous delivery or a server interruption never automatically resends the same recipient. Establish the delivery status before trying anything else.

## A personal button on Start
After sign-in and acceptance of the ONE invitation, **Set up Atlas access** appears on Start and under Workspace → People. Only a click reads the person's own access values. The modal initially masks the personal link and optional agent token; **Show values**, Copy and Open Atlas are explicit actions. Other members and admins cannot open someone else's values through this feature.

First task: follow **Home → Start step by step** where the workspace has an illustrated guide. Open Atlas, configure your own agent token under **Settings → AI → MCP servers**, select the exact MCP URL and needed read tools, test the connection and read one approved record. **My secrets** additionally supports explicitly handing personal connections to coding tasks. An invitation token in a link is not an MCP agent token. If no agent token is supplied, create your own in Atlas first.

After a successful test, confirm **I have successfully tested my personal connection** and press **Atlas access works · dismiss reminder**. This is the person's own confirmation, not an automatic test claimed by One. Only their reminder disappears; connections and tokens are neither deleted nor revoked at Atlas.

Protected access expires seven days after sending. Values are encrypted with the workspace's server key and recipient-bound outside shared documents. The server must be able to decrypt them for targeted mailing or retrieval; this is not an end-to-end vault. Long-term personal connections belong in the passphrase-protected **My secrets** vault.

The personal access modal also extracts recognized URL access tokens into a separate masked field with **Copy link token**. This does not verify MCP access or automatically store the token in an MCP connection.
