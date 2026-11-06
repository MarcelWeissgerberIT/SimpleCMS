---
id: 2026-11-06-analysis-source-check
date: 2026-11-06
order: 1
title: Dokumentanalyse prüft die benötigten Quellen
summary: Ein verbundener Atlas-Zugang erzwingt nicht mehr in jeder Dokument-Stufe einen zusätzlichen Abruf.
image: assets/shots/changelog/analysis-source-check.webp
alt: Dokument-Pipeline vor der Freigabe, mit Quellenabrufen im Log.
help: pipelines
try: coding
---
One kann eine Spezifikation aus der Aufgabe und den gespeicherten One-Dokumenten ableiten. Ein vorhandener Atlas-Zugang allein macht einen neuen Atlas-Abruf nicht mehr in jeder Stufe zur Pflicht. Erforderliche Quellenabrufe und ausdrücklich gewählte Prüfregeln gelten weiter.

Das Log nennt die in dieser Stufe gelesenen One-Seiten und zählt Atlas-Abrufe. Fehlt ein erforderlicher Abruf, erklärt die Aufgabe den Grund und behält die abgeschlossenen Dokumente. **Erneut versuchen** setzt bei der fehlgeschlagenen Stufe an; Freigaben bleiben bestehen.

Interne Block-IDs, die der Editor ergänzt, zählen nicht mehr als Quellenänderung. Inhaltliche Änderungen stoppen den Lauf weiterhin.
