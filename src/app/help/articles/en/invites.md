---
id: invites
title: Invites & registration links
section: team
order: 2
keywords: invite, invitation, link, email, join, register, registration link, sign-up, domain, admin, einladen, Einladung, Registrierung
related: members-roles, team-cloud, self-hosting
summary: Invite people by link or by email — server admins can also hand out registration links.
---
**Workspace settings → People → Invite people** (owners and admins). Choose the **Role** and **How to invite**:

## Link
- **Valid** for a number of days; **Uses**: single use or a number of people; optionally **Only addresses at** certain domains (e.g. `acme.com`).
- Links make members or viewers — invite admins by email.
- **Invite link · shown once**: copy it now; the server keeps only a fingerprint.

## Email
Enter up to 20 addresses (comma-separated or one per line) and **Send invites**. Everyone gets a single-use link that only works for their address. If a mail can't be sent, the invite still exists — **Copy link** and pass it on.

**Open invites** lists pending invites; **Revoke** ends one at once.

## Accepting
The link opens *You're invited.* Sign in with your email (new here? the link creates your account), then **Join**.

## Registration links (server admins)
Addresses listed in the server's `ADMIN_EMAILS` see **Settings → Server**: the **Sign-up** mode — **Open**, **Invite only** or **Domains** — and **Create registration link**. Whoever opens it can create an account and gets a space of their own, nothing else. Shown once; revoke any time.

## Guests in the same workspace
Choose **Guest · read only** access. The invitation opens this workspace with the same shared pages and live updates. Guests are marked under **People** and cannot edit content or invite other people. Guest access cannot prevent copying of readable content.

## Direct access without an email
When creating a link, enable **Direct access without a sign-in email**. It defaults to one use and one day. Anyone holding the link can enter their name and address and join immediately; no email is sent. New profiles are marked **Email unverified**. They cannot open an existing account, claim domain-based access, become administrators or register workers.

The access belongs to that browser session. Under **Settings → General**, use **Verify email now** for later sign-ins. Verification preserves membership and ends earlier sessions. An address already belonging to an account is never merged automatically: sign in to that account separately and request a new invitation. Existing signed-in users join with their account as usual.

Direct links cannot be restricted to an address/domain or grant administrator access. Use email invitations for these cases. Revoking a link stops future joins; remove an existing member separately.
