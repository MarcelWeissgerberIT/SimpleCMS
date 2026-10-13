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
Das KI-Menü, ⌘K **?**, Arbeitsbereich fragen, Umwandeln, Bilder und Dateien, Autofill, Besprechungsnotizen, das Gedächtnis und **Fragen** in der Hilfe können über OpenRouter laufen. Das KI-Terminal, Agenten, Skripte, Ausgang-Entwürfe und alles mit MCP-Servern laufen vorerst mit Claude — ihre Karten sagen es.

## Einstellungen → KI
Eine Platte je Anbieter: Zustand, **Prüfen (kostenlos)**, **Schlüssel ändern**, **Entfernen …** (nur den Schlüssel, oder Schlüssel und die Regeln dieses Geräts dafür, mit Rückgängig). Darunter: **Dieses Gerät** — ein Standard und eine Zeile je Art von Arbeit —, die Datenzeilen, deine eigenen Daten, der heutige Verbrauch und die MCP-Server.

> Schlüssel liegen versiegelt im Tresor dieses Browsers, je Anbieter — nie synchronisiert, nie in Sicherungen oder Exporten. Ein anderes Gerät fragt sie neu ab.
