---
id: ai-providers
title: KI-Anbieter — Claude, OpenRouter, der Jev Router
section: ai
order: 0
keywords: ki, anbieter, ki einrichten, einrichten, claude, anthropic, openrouter, openai, jev, jev router, typesafe, schlüssel, konto verbinden, modelle, schnell, standard, gründlich, router, kombinieren, zusammenspiel, dieses gerät, set up ai, provider, key, models
related: ai-data-rules, ai-costs, claude-key, ai-unreachable, privacy
summary: KI einmal einrichten — Claude, OpenRouter oder beide — und festlegen, wer auf diesem Gerät welche Arbeit übernimmt.
---
One hat kein KI-Abo: Jeder Anbieter bekommt **deinen eigenen Schlüssel** und rechnet ab, was du nutzt. Du kannst mehrere einrichten und kombinieren.

## KI einrichten
Den Assistenten öffnest du über **Einstellungen → KI → KI einrichten …**, über ⌘K **KI einrichten** oder über jede Karte, die sagt, dass KI noch nicht eingerichtet ist. Sechs Schritte; was du mit <kbd>Enter</kbd> bestätigst, bleibt — auch wenn du den Assistenten früher schließt.

1. **Anbieter** — schalte die Anbieter ein, die du willst. **Claude** (Anthropic) kann alles in One, MCP-Server eingeschlossen. **OpenRouter** gibt dir einen Schlüssel für Hunderte Modelle vieler Hersteller — manche sehr günstig —, aber keine MCP-Server. **OpenAI** folgt mit einem späteren Update.
2. **Schlüssel & Prüfung** — bei OpenRouter fragt **Konto verbinden** dich bei OpenRouter, ob One einen Schlüssel bekommt (du kopierst nichts und kannst dort gleich ein Ausgabenlimit setzen), oder du fügst einen Schlüssel ein. Für Claude fügst du einen Schlüssel aus der Anthropic-Konsole ein (er beginnt mit `sk-ant-`). Die **kostenlose Prüfung** fragt nur die Modellliste oder das Limit des Schlüssels ab — es wird kein Text gesendet. Versiegelt wird ein Schlüssel erst, wenn er sie besteht.
3. **Modelle** — drei Rollen je Anbieter: **Schnell** (viele kleine Aufgaben), **Standard** (Schreiben, Umformen, Fragen) und **Gründlich** (lange Aufgaben). Für OpenRouter schlägt One Modelle vor; **Ändern** öffnet den Katalog mit Preisen, Fähigkeiten und Betreibern.
4. **Daten & Grenzen** — was an welchen Anbieter darf. Ein neuer Anbieter startet mit nichts. Siehe [Datenregeln](help:ai-data-rules).
5. **Zusammenspiel** — wer auf diesem Gerät worauf antwortet: so lassen, alles über Claude, **ein Anbieter für alles** (sein Standard-Modell; Massenarbeit, Hilfe und Gedächtnis auf seinem schnellen) oder eigene Wahl in den Einstellungen.
6. **Fertig** — eine Übersicht, **Rückgängig** für Schritt 05 und **Auf einer Seite testen**.

## Der Jev Router
Mit mindestens zwei Modellen in deiner OpenRouter-Liste kann **Jev Router** (von TypeSafe, über OpenRouter) eine Rolle übernehmen: Er wählt für jede Anfrage das passende Modell deiner Liste und leitet sie dorthin weiter. Du zahlst je Anfrage; der Preis wird mit der Antwort gemeldet, und One reserviert vorher das teuerste Modell deiner Liste. Jev liest die Anfrage, um zu wählen.

## Jev als Vorprüfer
Die Zeile **Vorprüfer** in Schritt 03 steht zuerst auf **Aus**. **Jev 1.13 wählen** lässt Jev (ein Entscheidungsmodell von TypeSafe) zu jedem Vorschlag eines Agenten, dessen Abschnitt 06 die Vorprüfung einschaltet, vier feste Fragen beantworten — er markiert oder hält zurück, er schreibt nie. Siehe [Jev als Vorprüfer](help:ai-jev).

## Was in dieser Version wo läuft
Das KI-Menü, ⌘K **?**, Arbeitsbereich fragen, Umwandeln, Bilder und Dateien, Autofill, Besprechungsnotizen, das Gedächtnis und **Fragen** in der Hilfe können über OpenRouter laufen. KI-Terminal und Browser-Agenten unterstützen Claude, Copilot und werkzeugfähige lokale Modelle. Die Modellfähigkeit und Datenregeln entscheiden, welche weiteren Aktionen verfügbar sind; MCP nutzt die unten beschriebene persönliche Verbindung.

## Einstellungen → KI
Eine Platte je Anbieter: Zustand, **Prüfen (kostenlos)**, **Schlüssel ändern**, **Entfernen …** (nur den Schlüssel, oder Schlüssel und die Regeln dieses Geräts dafür, mit Rückgängig). Darunter: **Dieses Gerät** — ein Standard und eine Zeile je Art von Arbeit —, die Datenzeilen, deine eigenen Daten, der heutige Verbrauch und die MCP-Server.

> Schlüssel liegen versiegelt im Tresor dieses Browsers, je Anbieter — nie synchronisiert, nie in Sicherungen oder Exporten. Ein anderes Gerät fragt sie neu ab.

## Ollama Cloud zentral für Coding einrichten

Öffne **Einstellungen → KI → Ollama Cloud → API-Key und Modell einrichten …**. Dieselbe Karte steht unter **Coding-Worker**. Sie öffnet die geschützte Einrichtungsseite des Workers. Dort den Key einmal eintragen und speichern; alle Coding-Aufgaben mit Ollama Cloud auf diesem Worker teilen sich Key und Modell. Ist der Worker offline, führt die Karte zuerst zu seinen Verbindungseinstellungen. One liest und synchronisiert diesen Key nicht. Einstellungen öffnen und speichern sendet keine Modellanfrage; **Verbindung testen (Cloud-Anfrage)** ist eine eigene Aktion. Die Anbieterwahl für KI-Terminal und Browser-Agenten bleibt separat.

## Anbieter vor dem Modell wählen

Im KI-Menü, bei Fragen über **Mod+K → ?** und unter **Hilfe → Fragen** steht vor dem Modell eine eigene Anbieterauswahl. Ein verfügbarer Anbieter wählt den ersten nutzbaren Weg für diese Anfrage und öffnet die Modellliste dieses Anbieters. Dort das konkrete Modell wählen. Die normale Modelltaste oder **Alt+M** sucht über Anbieter hinweg; **Modelle des Anbieters** grenzt die Liste ein. Die Auswahl sendet keine Anfrage und ändert keinen Standard. **Standard auf diesem Gerät** kehrt zum eingestellten Weg zurück; nur die ausdrücklichen Standardtasten speichern eine Gerätevorgabe. Fehlende Schlüssel, Datenregeln und benötigte Fähigkeiten können Anbieter oder Modelle sperren. Mit einem verbundenen Worker ab 1.21 stehen hier zusätzlich lokale Ollama-Modelle, Ollama Cloud, MiniMax und Codex für Textanfragen zur Verfügung. Unter **Einstellungen → KI → Modelle beim Worker** Modelle laden und Datenregeln festlegen. Die Zugangsdaten bleiben beim Worker. Bilder, PDFs und strukturierte Werkzeugläufe benötigen weiterhin passende Modelle; Coding behält seine Agentenauswahl.


## Worker-Modelle und Kosten

Die Anbieterliste trennt Name und Verfügbarkeit. Gesperrte Einträge erklären den Grund und führen zur Einrichtung. Die Modellliste umfasst lokal installierte Ollama-Modelle, Ollamas Cloud-Katalog, das eingerichtete MiniMax-Modell und die vom Codex-CLI zwischengespeicherten Modelle. Der tatsächliche Modellzugriff hängt vom Konto ab und wird beim Senden geprüft. **Lokal** meint Inferenz beim gekoppelten Worker; bei einem Cloud-Worker liegt auch dieser Rechner außerhalb deines Macs. Ollama-Cloud-Aliasse werden nicht als lokale Modelle ausgeführt.

Unter **Kostenanzeige** gilt EUR/USD für alle erfassten Anbieter. Kurs und Datum werden genannt, gespeicherte Kosten und Limits bleiben USD. **Kosten unbekannt** bedeutet fehlenden Einzelpreis und niemals kostenlos. MiniMax ist eine Schätzung aus Tokenpreisen; Ollama Cloud und Codex können Tarifquoten nutzen. Ein USD-Limit kann Anfragen mit unbekanntem Preis blockieren.

Wenn Regeln für Worker-Anbieter gespeichert werden, fordert ein noch geöffnetes älteres One-Fenster zum Neuladen auf. So können ältere Fenster neue Anbieter- und Budgetregeln nicht übergehen.

## Atlas Flow und MCP in allen Textbereichen

Ab Worker 1.34.0 kannst du ein werkzeugfähiges lokales Ollama-Modell auch für Seitenfragen, strukturierte Textaktionen, das KI-Terminal und Browser-Agenten wählen. In **Agenten → Bearbeiten → Modell** setzt du die Ausnahme für einen Agenten; **Einstellungen → KI → Dieses Gerät** setzt den Standard je Arbeitsart. Modelle ohne bestätigte Werkzeugfähigkeit bleiben Textmodelle. Bilderkennung kommt dadurch nicht hinzu.

**Atlas einrichten:** Unter **Einstellungen → KI → MCP-Server** deine persönliche Atlas-Verbindung hinzufügen und prüfen. Unter den persönlichen Datenregeln MCP für **Lokal · Ollama** erlauben. Für externe MCP-Aufrufe muss dein eigener Worker verbunden sein. Im Agenten zusätzlich Atlas und nur die benötigten Werkzeuge auswählen. Eine Modellfreigabe übernimmt keine fremden Atlas-Rechte.

Das lokale Modell findet passende Werkzeuge über den Harness, liest Quellen und schlägt Änderungen vor. ONE prüft den Seitenbereich und hält Änderungen zur Abnahme bereit. Das Team entscheidet. Wiederholte identische Aufrufe werden begrenzt; fehlende Quellen und Kontextgrenzen bleiben sichtbar. Es gibt keinen stillen Wechsel zu einer Cloud-KI.

Beim geteilten Modell rechnet der freigegebene Host. ONE-Werkzeuge laufen in deinem Browser, Atlas-MCP über deinen persönlichen Worker. Der Modellhost erhält freigegebenen Kontext und Werkzeugergebnisse, keine Tokens. Private Seiten, Mail und persönliches Gedächtnis werden nicht automatisch geteilt. Zum Modellhost-Ausbau auf einer eigenen VM bleibt dieser Ablauf gleich; Ollama wird nicht öffentlich geöffnet.
