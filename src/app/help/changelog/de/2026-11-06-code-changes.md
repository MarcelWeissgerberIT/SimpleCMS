---
id: 2026-11-06-code-changes
date: 2026-11-06
order: 1
title: Kleine Codeänderungen in One prüfen
summary: Aus einem Finding einen begrenzten Vorschlag erstellen, Zeilen vergleichen und die angenommene Version an Atlas übergeben.
image: assets/shots/changelog/code-changes.webp
alt: Eine kleine UI-Änderung mit ursprünglichem Code, bearbeitbarem Ersatz und hervorgehobenen Zeilenunterschieden.
help: agent, pipelines
try: slash
---
Wähle **Änderung erstellen** an einem Codeanalyse-Finding. Wähle bis zu drei Quellbereiche desselben Snapshots und lade sie ausdrücklich in die Seite. Bearbeite den Ersatz selbst oder lass dein One-Modell einen Vorschlag erstellen.

Vergleiche die geänderten Zeilen und speichere Versionen. **Quellen prüfen und Vorschlag annehmen** prüft die festgelegte Quelle erneut. Die Annahme speichert den Vorschlag in One; Build und Tests wurden dabei nicht ausgeführt.

Speichere den angenommenen Vorschlag in Atlas oder lade das Änderungspaket herunter. Wenn die Atlas-Administration ein GitLab-Ziel konfiguriert hat, zeigt One Projekt und Zielbranch an. Ein eigener Button erstellt einen Branch mit Draft-Merge-Request. Zusammenführen und CI bleiben in GitLab; Atlas-Snapshots bleiben bis zum nächsten Import unverändert.
