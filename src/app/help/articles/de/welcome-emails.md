---
id: welcome-emails
title: Willkommensmails und persönlicher Atlas-Start
section: team
order: 9
keywords: workshop, willkommen, atlas, token, link, einladung, sammeln, import, gäste, start
related: invites, personal-secrets, workshop-startcheck, members-roles
summary: Empfänger privat vorbereiten, persönliche Links zuordnen und den Versand selbst freigeben.
---
Unter **Workspace → Personen → Willkommensmails** können Admins ihren eigenen privaten Entwurf vorbereiten. Er enthält Empfänger, E-Mail-Adresse, Ziel-Workspace, Rolle, persönlichen Atlas-Link und optional einen separaten Atlas-Agenten-Token. Andere Admins sehen diesen Entwurf nicht. Er ist kein Workspace-Inhalt, kein Modellkontext und kein Teil des Workspace-Exports.

Die Empfänger erscheinen zunächst als kompakte Platten-Karten mit Name, E-Mail, Ziel-Workspace, Zugang und Status. Ein Klick auf die Karte klappt die Eingabefelder auf; erneut klicken klappt sie zu. **Alle aufklappen** und **Alle zuklappen** steuern die gesamte Liste. Eingaben bleiben beim Zuklappen erhalten. Die Anzeigen unterscheiden „Atlas-Link bereit“, „Zugangstoken im Link erkannt“ und „Separater MCP-Token hinterlegt“. Sie bestätigen nur das Vorhandensein, keine Gültigkeit und keinen erfolgreichen Verbindungstest. Unter dem Link-Feld bleibt die Erkennung auch nach dem verschlüsselten Speichern sichtbar; das leere Feld bedeutet „gespeicherten Wert behalten“. Neue Personen öffnen sich direkt zur Bearbeitung.

## Namen, Links und Tokens gesammelt einfügen
Zuerst Empfänger hinzufügen oder vorbereitete Adressen korrigieren. Unter **Namen, Links und Tokens gesammelt einfügen** pro Person den vollen Namen oder die E-Mail-Adresse und die folgenden Felder einfügen:

```text
Max Beispiel
Link: https://atlas.example/invite?token=BEISPIEL
Token: SEPARATER-AGENTEN-TOKEN
```

Auch eine Zeile mit `Name | Link: … | Token: …` funktioniert. Der Parser läuft lokal ohne KI-Anfrage; Umlaute und ae/oe/ue werden zugeordnet. Nur Vorname, widersprüchliche Links, unbekannte Namen oder mehrdeutige Treffer werden zur Korrektur markiert. Separate Zugangsdaten werden auch unter `MCP-Token: …`, `Agent-Token: …`, `Agenten-Token: …`, `API-Key: …` und `Authorization: Bearer …` direkt extrahiert. Der Wert darf in der nächsten Zeile stehen; Anführungszeichen und Inline-Backticks werden entfernt. Bei Bearer-Angaben wird nur der Token gespeichert. Ein URL-Token wird nicht als MCP-Agenten-Token interpretiert; ein Einladungslink allein liefert keinen separaten MCP-Token. Bei Fehlern wird der Sammelimport vollständig zurückgehalten. Nach erfolgreicher Zuordnung Empfänger und Ziele prüfen und **Verschlüsselt speichern** drücken. Danach sind die Eingabewerte wieder verborgen; leere Felder behalten gespeicherte Werte.

## Versand bleibt ein bewusster Klick
**Manueller Versand frühestens** sperrt den Versand bis zum gewählten Zeitpunkt – auch auf dem Server. Es läuft kein automatischer Versandtimer. Speichern und Mailvorschau verschicken nichts und erzeugen keine Einladungen. Die Vorschau verbirgt persönliche Links. Vor dem Versand die Empfänger und Rollen bestätigen und **Willkommensmails senden** drücken.

Teammitglieder erhalten ihren Team-Workspace. Gäste können denselben Workspace mit **Gast · nur lesen** beobachten. Sie werden unter **Personen** beziehungsweise bei ihrer offenen Einladung als Gäste geführt. Sie sehen die gemeinsamen Seiten und Änderungen live, können aber keine Inhalte ändern, Agenten zur Änderung starten oder weitere Personen einladen. Persönliche Seiten und Secrets anderer bleiben unzugänglich. Lesbare Inhalte können kopiert werden. Ein separater Ziel-Workspace ist weiterhin optional. Die Mail enthält einen adressgebundenen ONE-Einladungslink, den persönlichen Atlas-Link und die erste Aufgabe. Ist die Person bereits Mitglied, führt ihr ONE-Link direkt in den Workspace. Separate MCP-Tokens stehen nicht in der Mail. ONE-Einladungen gelten sieben Tage; ein vorhandener Atlas-Link hat seine eigene Gültigkeit und muss zum Workshop noch funktionieren.

Der Status **An Mailserver übergeben** bestätigt die SMTP-Annahme, nicht die Zustellung im Postfach. Bei unklarem Versand oder einem Serverabbruch wird dieselbe Person nicht automatisch erneut angeschrieben. Erst Versandstatus klären; kein blindes Wiederholen.

## Persönlicher Button auf Start
Nach Anmeldung und Annahme der ONE-Einladung erscheint **Atlas-Zugang einrichten** auf Start und unter Workspace → Personen. Erst ein Klick liest die eigenen Zugangswerte. Das Modal zeigt den persönlichen Link und einen gegebenenfalls hinterlegten Agenten-Token zunächst verdeckt. Erkannte URL-Zugangstokens stehen zusätzlich in einem eigenen verdeckten Feld mit „Link-Token kopieren“; sie werden nicht automatisch als MCP-Token übernommen. **Werte anzeigen**, Kopieren und Atlas öffnen sind bewusste Aktionen. Andere Mitglieder und Admins können über diese Funktion keine fremden Werte öffnen.

Die erste Aufgabe: Auf **Start → Schritt für Schritt starten** dem bebilderten Leitfaden folgen, sofern er im Workspace vorbereitet ist. Über **Atlas-Zugang einrichten → Atlas mit Copilot verbinden** oder **Atlas mit Atlas Flow verbinden** übernimmt ONE den persönlichen Atlas-Token aus dem hinterlegten Zugangslink (oder einen separat hinterlegten Token). Der eigene Worker prüft Werkzeugliste und Identität ohne Modellanfrage. Nach erfolgreicher Prüfung wird die Verbindung im persönlichen Gerätetresor gespeichert und MCP ausschließlich für den gewählten Anbieter erlaubt. Ein verbundener Worker ist erforderlich. Bestehende andere Verbindungen und Modellstandards bleiben erhalten. Eine fehlende Atlas-Tenant-Mitgliedschaft wird gesondert angezeigt; die Einrichtung vergibt keine Atlas-Rechte. Danach einen freigegebenen Record im KI-Terminal lesen. **Einstellungen → KI → MCP-Server** bietet weiterhin die manuelle Einrichtung; **Meine Secrets** dient der ausdrücklichen Übergabe an Coding-Aufgaben. Eigene Rollen-Agenten können danach weiterhin in Atlas angelegt werden.

Nach dem erfolgreichen Test **Ich habe die persönliche Verbindung erfolgreich geprüft** bestätigen und **Manuell bestätigt · Hinweis entfernen** drücken. Das ist eine persönliche Bestätigung, keine von One behauptete automatische Prüfung. Nur der Hinweis dieser Person verschwindet; Verbindungen und Tokens werden dadurch nicht gelöscht oder bei Atlas widerrufen.

Die geschützte Bereitstellung endet sieben Tage nach dem Versand. Die Werte liegen mit dem Workspace-Server-Schlüssel verschlüsselt und empfängergebunden außerhalb der gemeinsamen Dokumente. Der Server muss sie für den gezielten Versand beziehungsweise Abruf entschlüsseln können; dies ist kein Ende-zu-Ende-Tresor. Dauerhaft genutzte persönliche Verbindungen gehören in den passphrasengeschützten Bereich **Meine Secrets**.
