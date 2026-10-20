---
id: 2026-10-20-ollama-cloud
date: 2026-10-20
order: 1
title: Ollama Cloud mit eigenem Key
summary: Ein Ollama-Cloud-Modell für Coding wählen und den Key im lokalen Worker speichern.
image: assets/shots/changelog/ollama-cloud.webp
alt: Coding-Aufgabe mit gewähltem Ollama Cloud und Hinweis zur Cloud-Datenverarbeitung.
help: coding-pipeline, agent
try: coding
---
Wähle **Ollama Cloud** unter Typ einer Coding-Aufgabe oder getrennt für BA, Coding und QA eines Prüfauftrags. Der gemeinsame One-/Atlas-Harness liefert Kontext, Aufgabengedächtnis, Werkzeuge und Prüfungen auf dem Rechner.

Ab Worker **1.19.0** öffnest du **Ollama Cloud einrichten**. Trage deinen Ollama-API-Key im Passwortfeld ein und wähle das Cloud-Modell mit seinem API-Namen (anfangs `minimax-m3.1-flash`). Speichern sendet keine Modellanfrage. **Verbindung testen** sendet eine kleine Cloud-Anfrage mit den gespeicherten Einstellungen.

Der Key bleibt in einer privaten Worker-Datei außerhalb des synchronisierten Arbeitsbereichs. Ausgewählter Quelltext und Werkzeugergebnisse gehen an Ollama. Es gelten Ollamas Tariflimits; One kann für diesen Abotarif keine Dollarbudgets messen oder durchsetzen. Schrittlimits, Berechtigungen und Prüfungen gelten weiter. Lokales Ollama bleibt separat wählbar.

Das KI-Terminal kennzeichnet lange Seitenabrufe außerdem mit **Teil 1 von 4**, **Teil 2 von 4** und so weiter. Gezählt werden die tatsächlichen Textabschnitte; wiederholte Abrufe lassen sich dadurch leichter unterscheiden.
