---
id: gmail-sync
title: Gmail sync
section: mail
order: 1
keywords: gmail, mail, email, google, inbox, connect gmail, oauth, client id, sync mails, labels, organise, contacts, companies, conversations, attachments, pdf, E-Mail, Mails, Postfach, Kontakte, Firmen, Anhänge
related: privacy, claude-key, databases, team-cloud
summary: Your Gmail as a database in One — connected in one click, read-only, with contacts, companies, conversations and attachments when you want them.
---
One reads Gmail straight from this browser — no server in between, and only ever reading (`gmail.readonly`).

## Connect in one click
**Settings → Mail → Connect Gmail.** One brings its own Google access, so there is nothing to set up. Google's window asks once which account to use and for read access to Gmail.

While Google is still reviewing One's access, its window warns that *Google hasn't verified this app* — that is expected: click **Continue**. During the review only accounts the operator has approved can connect. Anyone else gets a refusal from Google; One then says so and offers **Use your own Google client** (see below) — or ask the operator to add your address.

One's access works on getonecms.com. In a copy of One elsewhere — your own team server, a local build — Settings → Mail shows the setup for your own client instead.

## Sync
After connecting, choose:
- **Sync mails from** — mails received on or after this day (default: 30 days ago),
- **Labels** — e.g. Inbox; **Skip spam and trash**,
- **Mails per run** and **When**: when One opens, every few minutes, or manually (**Sync now**).

**Sync now** is also one of the Mails database's [commands](help:database-commands): the **⌘** key on its row in the sidebar, or ⌘K → *Mails: Sync now*.

The first sync creates the **Mails** database: subject, from, to, date, labels, unread, attachments, a Gmail link — and the mail itself as the page. The Gmail LED in its header opens these settings. Remote images are blocked until you click **Load images**. Your edits to rows stay; a re-sync only updates Gmail's fields.

## Contacts, companies, conversations
**Contacts & companies** (on by default) turns addresses and thread numbers into names. The sync fills three linked databases next to Mails and links every mail:
- **Contacts** — one per person, found by address. The name comes from the sender line (`Felix Merz <felix@firma.de>` → Felix Merz). A mail you sent yourself is linked to whom it went to.
- **Companies** — one per domain (*mueller-gmbh.de* → Mueller GmbH). Freemail domains like gmail.com or gmx.de never become a company; the list under **Never a company** is yours to edit.
- **Conversations** — one per Gmail thread, named by its subject without *Re:*, *AW:* or *Fwd:*.

Rename an entry once and every mail shows the new name — matching always uses the stored addresses, domains and thread ids, never the name. Two entries for the same person or company: **Merge…** in Settings → Mail moves the addresses, domains and links over and puts the other entry in the trash, with Undo. Switched on later, the earlier mails are linked in one go.

## Attachments
Each mail lists its attachments with a **Load** key (and **Load all**). Loading fetches the file from Gmail into One and puts it in the page as a real block: a PDF in the browser's own viewer, an image, audio or video, anything else as a file to download. HTML, SVG and XML attachments are only offered as a download, never shown. Files over 25 MB stay in Gmail — the list links to the mail.

A loaded file is a block like any other: its **AI** key summarises a PDF, pulls out its text or tables, opens a Word or HTML file as a page, imports a CSV or Excel sheet as a database — see [Claude for files](help:ai-menu). The file reaches Anthropic only with the Claude actions; the conversions stay on this device.

**Load attachments automatically** (Settings → Mail): *Off* (default), *PDFs + images* up to 10 MB, or *All* up to 25 MB — for new mails. Loaded files stay when the mail syncs again. When Google's sign-in has expired, the key asks you to sign in first.

## Organise with Claude
Off by default. When on (needs [your Claude key](help:claude-key)), each new mail gets a **Category** from your list, a **Priority**, **Needs reply** and a **One-line summary**, optionally a link to a row of a database like Projects.

## Your own Google client (advanced)
For your own Google Cloud project — when your account isn't approved for One's access yet, or your organisation wants its own client. Open **Use your own Google client (advanced)** in Settings → Mail:
1. Create a project in the **Google Cloud console** (any name).
2. Enable the **Gmail API** for that project.
3. Set up the **OAuth consent screen**: audience *External*, leave it in *Testing* and add your own Google address as a test user.
4. Create an **OAuth client** of type *Web application* and add the **Authorized JavaScript origins** One shows (e.g. `https://getonecms.com`).
5. Copy the **client ID** (it ends in `.apps.googleusercontent.com`) and paste it into **OAuth client ID**. Only the ID — One never needs a client secret.

Your own client ID always takes precedence. **Back to One's access** forgets it on this device; the Mails database and the sync settings stay.

> One only reads Gmail (scope `gmail.readonly`): deleting a row never deletes a mail. Google's access token lives only in this tab's memory and expires after about an hour. Mail content reaches Anthropic only while **Organise with Claude** is on. In a team workspace, Mails, Contacts, Companies and Conversations are created in your **Private** section.
