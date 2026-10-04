---
id: gmail-sync
title: Gmail sync
section: mail
order: 1
keywords: gmail, mail, email, google, inbox, oauth, client id, sync mails, labels, organise, E-Mail, Mails, Postfach
related: privacy, claude-key, databases, team-cloud
summary: Your Gmail as a database in One — read-only, from a day you choose, organised by Claude if you like.
---
One reads Gmail straight from this browser — no server in between. Because of that, you use **your own Google client** (a one-time setup, about 5 minutes). **Settings → Mail** walks you through it with links.

## Set up your Google client
1. Create a project in the **Google Cloud console** (any name).
2. Enable the **Gmail API** for that project.
3. Set up the **OAuth consent screen**: audience *External*, leave it in *Testing* and add your own Google address as a test user.
4. Create an **OAuth client** of type *Web application* and add the **Authorized JavaScript origins** One shows (e.g. `https://getonecms.com`).
5. Copy the **client ID** (it ends in `.apps.googleusercontent.com`) and paste it into **OAuth client ID**. Only the ID — One never needs a client secret.

## Connect and sync
**Connect Gmail** opens Google's window; grant read access. Then choose:
- **Sync mails from** — mails received on or after this day (default: 30 days ago),
- **Labels** — e.g. Inbox; **Skip spam and trash**,
- **Mails per run** and **When**: when One opens, every few minutes, or manually (**Sync now**).

The first sync creates the **Mails** database: subject, from, to, date, labels, unread, attachments, a Gmail link — and the mail itself as the page. The Gmail LED in its header opens these settings. Remote images are blocked until you click **Load images**. Your edits to rows stay; a re-sync only updates Gmail's fields.

## Organise with Claude
Off by default. When on (needs [your Claude key](help:claude-key)), each new mail gets a **Category** from your list, a **Priority**, **Needs reply** and a **One-line summary**, optionally a link to a row of a database like Projects.

> One only reads Gmail (scope `gmail.readonly`): deleting a row never deletes a mail. Google's access token lives only in this tab's memory and expires after about an hour. Mail content reaches Anthropic only while **Organise with Claude** is on. In a team workspace, the Mails database is created in your **Private** section.
