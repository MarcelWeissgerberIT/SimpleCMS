---
id: personal-secrets
title: Meine Secrets · Persönlicher Tresor
section: ai
order: 19
keywords: secrets, tresor, passphrase, atlas token, agenten token, claude code, sicherheit, persönlicher speicher
related: mcp-servers, custom-agents, coding-harness
summary: Atlas- und Agenten-Tokens pro Person verschlüsselt speichern und gezielt für eine Coding-Aufgabe freigeben.
---
## Den Tresor einrichten

Öffne **Einstellungen → Meine Secrets**. Mit Team-Anmeldung gehört der Tresor deinem One-Konto, über deine Workspaces hinweg. Der Team-Server speichert nur einen bereits im Browser verschlüsselten Tresor. Auf einem rein lokalen Gerät ohne Team-Server bleibt er in diesem Browserprofil.

Wähle eine eigene Passphrase mit mindestens 14 Zeichen und wiederhole sie. Die Passphrase wird nicht gespeichert und ist nicht wiederherstellbar. Sie ist unabhängig von der Anmeldung bei One. Der Tresor sperrt sich nach zehn Minuten ohne Tresoraktion oder Freigabe sowie beim Abmelden; **Jetzt sperren** sperrt sofort. Bereits laufende Coding-Aufträge werden dadurch nicht beendet.

## Atlas- und Agenten-Tokens hinterlegen

Jeder Eintrag hat einen eindeutigen Namen, die genaue öffentliche HTTPS-MCP-Adresse, ein Token und eine explizite Liste erlaubter Werkzeuge. Beispielsweise `atlas-me` für deinen persönlichen Zugang und `atlas-ba` für den eigenen BA-Agenten. Verwende die von eurer Atlas-Installation angegebene Adresse.

Das Token wird beim Speichern nicht getestet oder an Atlas gesendet. Wähle zuerst lesende Werkzeuge wie `atlas_whoami`, `atlas_search`, `atlas_get` oder `atlas_context`, soweit eure Verbindung sie anbietet. Die Werkzeugliste erweitert nicht die Rechte des Tokens. Projekt- und Tenant-Beschränkung sowie Laufzeit werden zusätzlich in Atlas festgelegt.

**Bearbeiten** kann ein Token ersetzen; leer behält es bei. **Aus Tresor entfernen** entfernt nur den gespeicherten Eintrag. Das eigentliche Token widerrufst du bei Atlas. Bestehende MCP-Verbindungen und Provider-Schlüssel werden nicht automatisch migriert oder verändert.

## Gezielt mit einem Coding-Agenten nutzen

Öffne eine Coding-Aufgabe mit verbundenem aktuellem Worker. Unter **Meine Secrets · Verbindungen für diese Aufgabe** wählst du ausdrücklich die Verbindungen für diesen Auftrag und den angezeigten Worker. Die Auswahl gilt nur in dieser Browser-Sitzung und diesem Workspace; sie wird nicht exportiert oder geteilt. Entsperre den Tresor vor dem Start. Ein älterer Worker oder eine andere Coding-Laufzeit übernimmt diese Auswahl nicht stillschweigend: Ab Worker 1.28.0 ist sie für alle Coding-Agenten verfügbar; ältere Worker übernehmen die Auswahl für weitere Agenten nicht.

Der Worker erhält nur die ausgewählten Verbindungen, hält Tokens im Speicher und stellt dem gewählten Coding-Agenten die Werkzeuge `one_task_mcp_search` und `one_task_mcp_call` bereit. Der Coding-Agent entdeckt dort Schemas und ruft erlaubte Werkzeuge auf. Es erhält keine Tokenwerte im Prompt oder in einer Projektdatei. Der temporäre MCP-Starter enthält nur den bereits üblichen, laufgebundenen One-Task-Zugang. Bei dieser persönlichen Freigabe lädt der Coding-Agent keine zusätzlichen MCP-Verbindungen aus der normalen Worker-Konfiguration. Nach Ende des Laufs werden die Verbindungen geschlossen. Nach einer geänderten Worker-Verbindung muss die Auswahl erneut freigegeben werden.

Plan- und Dokumentationsschritte erhalten nur bekannte beziehungsweise als lesend gekennzeichnete Werkzeuge. Im Umsetzungsschritt können ausdrücklich erlaubte Schreibwerkzeuge sofort in Atlas schreiben; Ones Vorschlagsmodus hält diese externen Aufrufe nicht zurück. Für einen Zugangstest deshalb ein passend eingeschränktes Token und eine kleine Werkzeugliste verwenden.

## Bereits eingerichtetes Atlas für eine Coding-Aufgabe nutzen

Wenn dein persönlicher Atlas-Zugang unter **Einstellungen → KI → MCP-Server** erfolgreich geprüft ist, öffne die Coding-Aufgabe und **Meine Secrets · Verbindungen für diese Aufgabe**. Unter **Dein bereits eingerichteter Atlas-Zugang** wählst du **Atlas für diese Aufgabe nutzen**. Du musst den Token nicht erneut kopieren oder einen zweiten Tresor anlegen.

Diese ausdrückliche Freigabe gilt nur für dich, diese Aufgabe und den angezeigten gekoppelten Worker in dieser Sitzung. Sie erlaubt ausschließlich `atlas_whoami`, `atlas_search`, `atlas_get` und `atlas_context`, soweit Atlas sie anbietet. Der Anbieter muss MCP-Ergebnisse erhalten dürfen. Nach einer geänderten Verbindung bestätigst du die Auswahl erneut; beim Schließen oder Abmelden endet sie. Eine andere Person muss ihren eigenen Zugang wählen. Gäste erhalten keine Coding-Freigabe.

Für zusätzliche oder externe Schreibwerkzeuge bleibt der separate, mit Passphrase geschützte Tresor vorgesehen. Eine Aufgabe weiterzureichen überträgt niemals deinen Token. Die übernehmende Person prüft die Aufgabe und gibt ihre eigene Verbindung frei.

## Was geschützt wird

Tokens und Verbindungsmetadaten liegen im persönlichen Tresor mit AES-256-GCM, eigener Zufalls-Salt und PBKDF2-SHA-256 mit 600.000 Iterationen. Der Schlüssel ist im Browser nicht exportierbar und nur während der Entsperrung im Speicher. Der Server bindet den verschlüsselten Tresor ausschließlich an die angemeldete Person; auch Workspace-Administratoren erhalten keine fremden Tresore. Änderungen auf mehreren Geräten überschreiben sich nicht stillschweigend: bei einem Konflikt neu laden und entsperren.

Workspace-Inhalte, Importe, Exporte und gemeinsame Agentendefinitionen enthalten keine Tresor-Tokens. Die ausgewählten Tokenwerte werden aus Worker-Ausgaben entfernt. Bewahre Tokens dennoch nie in Seitentexten oder Prompts auf. Eine kompromittierte One-Anwendung, ein fremdgesteuerter Browser oder ein nicht vertrauenswürdiger Worker kann entsperrte Zugangsdaten nutzen. Verwende vertrauenswürdige Geräte und begrenzte, widerrufbare Atlas-Tokens.
