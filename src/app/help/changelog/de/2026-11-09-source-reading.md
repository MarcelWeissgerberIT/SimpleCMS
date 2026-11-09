---
id: 2026-11-09-source-reading
order: 2
summary: Zusammenhängende Quellen, begrenzte parallele Reads und sichtbare Cache-Werte.
image: assets/shots/changelog/source-reading.webp
alt: Quellenbilanz im Log einer One-Dokumentanalyse.
help: agent
try: terminal
title: Quellen zusammenhängend lesen
date: 2026-11-09
---

One stellt passende Seiten jetzt innerhalb eines begrenzten Lesebudgets zusammenhängend bereit. Größere Quellen behalten eindeutige Fortsetzungsstellen. Überlappende Abschnitte zählen nicht mehrfach als neue Quelle; fehlende Bereiche und geänderte Quellenstände bleiben erkennbar.

Unabhängige Leseaufrufe in festen Kompilaten laufen in Gruppen von bis zu drei. Abhängige Schritte und Änderungen warten auf die vorherigen Ergebnisse.

Im Log stehen die vollständig bereitgestellten Quellenstände, eindeutige und erneut gelesene Zeichen, Modellantworten, Dauer, bekannte Kosten und die tatsächlichen Cache-Werte. Eine bereitgestellte Quelle ist noch kein bestätigter Beleg für ein Finding.
