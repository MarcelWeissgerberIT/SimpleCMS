---
id: self-hosting
title: Self-hosting & encryption
section: team
order: 4
keywords: self-host, server, docker, install, hosting, encryption, data key, DATA_KEY, backup, smtp, admin, AGPL, selbst hosten, Server, Verschlüsselung
related: team-cloud, invites, public-api, privacy
summary: Run your own One server — one Docker container, about 30 minutes. Content is encrypted at rest.
---
The team server is one process: the app, the API and live sync, with SQLite. The step-by-step guide is in the repository: [docs/SELF_HOSTING.md](https://github.com/MarcelWeissgerberIT/SimpleCMS/blob/main/docs/SELF_HOSTING.md).

## In short
1. A small Linux server and a domain pointing to it.
2. Docker, the code from GitHub, and a configuration: the public URL, `SECRET`, `DATA_KEY`, SMTP for the sign-in mails, `ADMIN_EMAILS`.
3. Start it — Caddy fetches the HTTPS certificate.
4. Sign in with an admin address and create the first workspace.

## Encryption at rest
Every workspace has its own random key; it is stored only wrapped with your `DATA_KEY` (AES-256-GCM). Page content, files and file names are encrypted on disk. Keep `DATA_KEY` in a password manager, never next to the backups: without it the data cannot be read — by anyone.

## Backups and updates
The guide covers nightly snapshots or continuous replication, restoring (test it once!), rotating `DATA_KEY`, and updating to a new version.

> The server is licensed AGPL-3.0; the app stays MIT. More detail: `docs/CLOUD.md`.
