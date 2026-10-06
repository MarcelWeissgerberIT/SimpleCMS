---
id: 2026-10-06-coding-setup
date: 2026-10-06
order: 2
title: Der Coding-Worker in drei Schritten — herunterladen, starten, Repos anhaken
summary: Der Worker kommt jetzt schon gekoppelt aus One, findet die Git-Repositories auf deinem Rechner und lässt dich die anhaken, in denen One arbeiten darf — ohne Konfigurationsdatei.
image: assets/shots/changelog/coding-setup.webp
alt: Einstellungen → Coding-Worker mit den drei erledigten Schritten — der Worker für diesen Arbeitsbereich heruntergeladen, mit node ~/Downloads/one-worker.mjs gestartet, zwei Repositories angehakt — und dem Status Verbunden · studio-mac · 2 Repos
help: coding-pipeline
try: coding
---
Den Coding-Worker einzurichten hieß bisher: ein Init-Befehl und eine selbst geschriebene `worker.json`. Jetzt ist es eine Karte unter **Einstellungen → Coding-Worker** (und auf **#/coding**):

1. **Lade den Worker für diesen Arbeitsbereich herunter** — die Datei ist schon mit diesem Browser und diesem Arbeitsbereich gekoppelt. One schaltet die Verbindung selbst ein.
2. **Starte ihn**: `node ~/Downloads/one-worker.mjs`.
3. **Hak deine Repositories auf der Seite an, die sich öffnet.** Der Worker sucht die Git-Repositories auf deinem Rechner und öffnet eine kleine Seite in deinem Browser: Repo anhaken, Basis-Branch und Testbefehl prüfen, **Speichern & starten**. One zeigt sofort *Verbunden · laptop · 2 Repos*.

**Repositories ändern** öffnet die Seite später wieder. Zu One kommen nur die Namen deiner Repos — Pfade und Befehle bleiben auf deinem Rechner, und One kann nie selbst ein Repo anhaken. Ein neuer Download ersetzt die Kopplung, eine ältere Kopie der Datei funktioniert dann nicht mehr. Mehr in [der Anleitung](help:coding-pipeline).
