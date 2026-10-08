---
id: 2026-10-08-cloud-worker
date: 2026-10-08
order: 7
title: Der Coding-Worker auf jedem Rechner – über deinen Team-Server
summary: In einem Team-Arbeitsbereich lässt Einstellungen → Coding-Worker → Lokal | Cloud den Worker auf einem Build-Server oder einer VM laufen; er verbindet sich selbst mit dem One-Server, der nur Nachrichten weiterreicht, die zwischen diesem Browser und dem Worker versiegelt sind.
image: assets/shots/changelog/cloud-worker.webp
alt: Einstellungen → Coding-Worker in einem Team-Arbeitsbereich – Wo der Worker läuft steht auf Cloud, der Cloud-Worker ist heruntergeladen, darunter der Status Verbunden · build-box · 1 Repo · über Cloud
help: coding-pipeline, team-cloud
try: settings-coding
---
**Lokal oder Cloud.** In einem Team-Arbeitsbereich auf einem One-Server bietet **Einstellungen → Coding-Worker → Wo der Worker läuft** jetzt **Lokal | Cloud**. Mit **Cloud** läuft der Worker auf einem beliebigen Rechner – Build-Server, VM, der Rechner im Büro – und verbindet sich selbst mit deinem One-Server: kein Port, kein VPN.

**Drei Schritte.** Lade **one-worker-cloud.mjs** herunter (die Datei enthält einen Token nur für dich und nur für diesen Arbeitsbereich), kopiere sie auf jenen Rechner und starte sie dort mit `node one-worker-cloud.mjs`, dann hake dort die Repositories an. Die Karte zeigt *Verbunden · build-box · 1 Repo · über Cloud*, und Aufgaben laufen wie mit einem lokalen Worker.

**Durchgehend versiegelt.** Jede Nachricht zwischen diesem Browser und dem Worker ist mit einem Schlüssel verschlüsselt, den nur die beiden haben – aus diesem Download. Der Server reicht die versiegelten Pakete weiter: Aufgabentext, Code, Diffs und Logs kann er weder lesen noch ändern, und er speichert nichts davon. **Widerrufen** beendet den Worker endgültig.

> Tipp: Die Arbeit wird aus einem offenen Tab verteilt – lass One in diesem Browser offen, solange Aufgaben laufen sollen. Cloud braucht den One-Server unter `https://`; in einem lokalen Arbeitsbereich bleibt die Option ausgegraut, mit dem Grund daneben. Mehr: [Coding-Pipeline](help:coding-pipeline).
