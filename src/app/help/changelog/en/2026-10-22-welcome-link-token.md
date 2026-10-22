---
id: 2026-10-22-welcome-link-token
date: 2026-10-22
order: 7
title: Atlas link tokens have their own status
summary: Invitation preparation distinguishes a token inside a link from a separately stored MCP token, with aligned input fields.
image: assets/shots/changelog/welcome-link-token.webp
alt: A recipient card with aligned credential fields and separate status indicators for the Atlas link token and MCP token.
help: welcome-emails, personal-secrets
try: welcome
---
Recipient cards now say **Access token detected in link** independently of **Separate MCP token stored**. A saved blank input keeps its existing value; the status is calculated without returning the secret. Recognition confirms presence, not validity or MCP access.

The personal Atlas access modal can extract the link token into its own masked field and **Copy link token**. It stays separate from a supplied MCP agent token. No token is copied automatically into an MCP connection.

The two credential fields now share their label and input rows, even when a label wraps. Helper text no longer shifts one input down. Preview and Remove sit together. Saving and opening the page still send no invitations.
