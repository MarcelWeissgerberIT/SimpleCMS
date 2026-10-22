---
id: 2026-10-22-welcome-link-token
date: 2026-10-22
order: 7
title: Atlas-Link-Token mit eigenem Status
summary: Die Vorbereitung unterscheidet den Token im Link vom separaten MCP-Token und richtet die Eingabefelder sauber aus.
image: assets/shots/changelog/welcome-link-token.webp
alt: Eine Empfängerkarte mit ausgerichteten Zugangsfeldern und getrennten Statusanzeigen für Atlas-Link-Token und MCP-Token.
help: welcome-emails, personal-secrets
try: welcome
---
Empfängerkarten zeigen jetzt **Zugangstoken im Link erkannt** getrennt von **Separater MCP-Token hinterlegt**. Ein leeres Eingabefeld behält einen gespeicherten Wert; der Status wird berechnet, ohne den Token zurückzugeben. Die Erkennung bestätigt das Vorhandensein, keine Gültigkeit oder MCP-Berechtigung.

Im persönlichen Atlas-Zugang lässt sich der Link-Token in ein eigenes verdecktes Feld extrahieren und mit **Link-Token kopieren** übernehmen. Er bleibt vom separat hinterlegten MCP-Agenten-Token getrennt. One überträgt ihn nicht automatisch in eine MCP-Verbindung.

Die beiden Zugangsfelder teilen sich nun Beschriftungs- und Eingabezeilen, auch bei umbrochenem Text. Hilfetexte verschieben das zweite Feld nicht mehr nach unten. Vorschau und Entfernen stehen nebeneinander. Speichern und Öffnen verschicken weiterhin keine Einladungen.
