---
id: self-hosting
title: Selbst hosten & Verschlüsselung
section: team
order: 4
keywords: selbst hosten, self-host, server, docker, installieren, hosting, verschlüsselung, data key, DATA_KEY, backup, smtp, admin, AGPL
related: team-cloud, invites, public-api, privacy
summary: Betreib deinen eigenen One-Server — ein Docker-Container, etwa 30 Minuten. Inhalte sind auf der Platte verschlüsselt.
---
Der Team-Server ist ein Prozess: die App, die API und der Live-Sync, mit SQLite. Die Schritt-für-Schritt-Anleitung liegt im Repository: [docs/SELF_HOSTING.md](https://github.com/MarcelWeissgerberIT/SimpleCMS/blob/main/docs/SELF_HOSTING.md) (englisch).

## Kurz gesagt
1. Ein kleiner Linux-Server und eine Domain, die darauf zeigt.
2. Docker, der Code von GitHub und eine Konfiguration: die öffentliche URL, `SECRET`, `DATA_KEY`, SMTP für die Anmelde-Mails, `ADMIN_EMAILS`.
3. Starten — Caddy holt das HTTPS-Zertifikat.
4. Mit einer Admin-Adresse anmelden und den ersten Workspace anlegen.

## Verschlüsselung auf der Platte
Jeder Workspace hat einen eigenen Zufallsschlüssel; gespeichert wird er nur verpackt mit deinem `DATA_KEY` (AES-256-GCM). Seiteninhalte, Dateien und Dateinamen liegen verschlüsselt auf der Platte. Bewahre `DATA_KEY` in einem Passwortmanager auf, nie neben den Backups: Ohne ihn lassen sich die Daten nicht lesen — von niemandem.

## Backups und Updates
Die Anleitung beschreibt nächtliche Snapshots oder laufende Replikation, das Wiederherstellen (einmal ausprobieren!), das Wechseln von `DATA_KEY` und Updates auf eine neue Version.

> Der Server steht unter AGPL-3.0; die App bleibt MIT. Mehr Details: `docs/CLOUD.md`.
