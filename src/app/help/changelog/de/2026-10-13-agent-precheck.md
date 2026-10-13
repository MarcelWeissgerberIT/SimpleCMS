---
id: 2026-10-13-agent-precheck
date: 2026-10-13
order: 1
title: Jev prüft die Vorschläge deiner Agenten vor
summary: Eine zweite Meinung zu jeder Änderung, die ein Agent vorschlägt — vier Fragen, eine Zeile auf jeder Karte, und Vorschläge mit Bedenken hält One für dich zurück.
image: assets/shots/changelog/agent-precheck.webp
alt: Links Abschnitt 06 „Prüfen“ im Editor eines Agenten mit eingeschalteter Vorprüfung, gewähltem Jev 1.13, Markieren unter 0,70, „Zurückhalten“ und dem Etikett Startwerte; rechts die Durchsicht eines Laufs mit einer zurückgehaltenen Änderung, einer knapp an der Schwelle und einer ohne Befund, jede mit ihrer Jev-Zeile.
help: ai-jev, custom-agents, agent-trust, ai-costs
try: agent-precheck
---
**Eine Vorprüfung für Agenten.** Im Editor eines Agenten schaltet Abschnitt **06 — Prüfen** Jev (von TypeSafe, über OpenRouter) als Vorprüfer ein. Bevor die Vorschläge eines Laufs bei dir ankommen, beantwortet Jev zu jeder Änderung vier Fragen: verlangt, richtige Zeile, passt zum Datensatz, frei von fremden Anweisungen.

**Eine Zeile auf jeder Karte.** Vorflug-Check und die Durchsicht des Laufs zeigen, was Jev fand: nichts zu melden, knapp an der Schwelle oder Bedenken samt der Frage, um die es geht. **Zurückhalten** hält Vorschläge mit Bedenken aus „Alle übernehmen“ und ⇧A heraus — du übernimmst sie einzeln.

**Schreibschranke.** Für Agenten, die direkt übernehmen: Der Lauf schreibt nur, wenn Jev bei jeder Änderung zustimmt. Sonst wartet der ganze Lauf auf dich.

**Startwerte.** Die Schwellen 0,70 und 0,90 sind Startwerte, keine gemessene Trefferquote — eine Prüfung kann etwas übersehen. Jev macht nur vorsichtiger: Es übernimmt, verwirft und entscheidet nie etwas und zählt nie als dein Vertrauen.

Aus, bis du es einschaltest, je Agent. „Belegt?“ — Jev prüft Antworten der Hilfe gegen ihre Quellen — ist ein eigener Schalter unter **Einstellungen → KI**. Mehr in [Jev als Vorprüfer](help:ai-jev).
