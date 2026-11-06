---
id: 2026-10-21-worker-workspaces
date: 2026-10-21
order: 2
title: Ein Geräte-Worker, getrennte Workspaces
summary: Weitere Workspaces einmal freigeben, Modellverbindungen behalten und Auftragsstände getrennt führen.
image: assets/shots/changelog/worker-workspaces.webp
alt: TestSpace-Einstellungen mit der Freigabe für den bereits laufenden Geräte-Worker.
help: coding-pipeline, workspace
try: settings-coding
---
Ein gekoppelter lokaler Coding-Worker kann jetzt mehrere ausdrücklich freigegebene Workspaces bedienen. Worker **1.22** zuerst im ursprünglichen Workspace starten. In einem weiteren Workspace unter **Einstellungen → Coding-Worker** auf **Diesen Workspace am Geräte-Worker freigeben** klicken. Verwende das ursprüngliche Browser-Profil.

Modelle, API-Schlüssel und persönliche MCP-Verbindungen bleiben auf dem Gerät. Jeder zusätzliche Workspace erhält einen eigenen Kopplungsschlüssel, Auftragsstand, Memory, Scratch-Ordner, Worktrees und automatisch angelegte Branches. Ein Workspace-Wechsel leitet laufende Aufträge oder Ergebnisse nicht um. Repository-Sperren, Parallelität und Tageslimits gelten übergreifend.

Unter **Weitere Arbeitsbereiche auf diesem Gerät** auf der geschützten Einrichtungsseite des Workers lässt sich eine Freigabe entziehen. Das stoppt die Aufträge dieses Workspace und erhält gespeicherte Arbeitsstände. Cloud-Worker über den Team-Relay behalten ihre Bindung an Workspace und Mitglieds-Token.
