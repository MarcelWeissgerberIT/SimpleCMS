---
id: ai-autofill
title: KI-Autofill
section: databases
order: 10
keywords: autofill, ki, claude, zusammenfassen, herausziehen, kategorisieren, übersetzen, spalte füllen, ausfüllen, ai
related: properties, claude-key, automations, governor
summary: Lass Claude eine Eigenschaft für jeden Eintrag füllen — eine Zusammenfassung, eine Kategorie, ein Detail aus der Seite.
---
1. Klick auf den Kopf einer Eigenschaft (Text, Zahl, Auswahl, Mehrfachauswahl, Checkbox, URL …) → **KI-Autofill…**
2. **Was Claude tun soll:** **Zusammenfassung**, **Kerninfo** (sag, was herausgezogen werden soll), **Übersetzen**, **Kategorisieren** (wählt aus den Optionen der Eigenschaft; **Neue Optionen erlauben** lässt Claude neue vorschlagen) oder **Eigene Anweisung**.
3. Prüf die **Schätzung** — Zeilen, Tokens rein und raus, Kosten — und starte: **Leere Zeilen füllen** oder **Alle Zeilen füllen**.

Claude liest pro Eintrag den Titel, die anderen Eigenschaften und den Anfang der Seite. Ergebnisse warten auf deine Prüfung, außer du wählst **Ohne Prüfung übernehmen**.

**Automatisch aktualisieren, wenn sich die Seite ändert** hält die Eigenschaft aktuell: ein paar Sekunden nach einer Änderung wird der Eintrag neu gefüllt — solange One geöffnet ist.

**An der Rotlinie.** Ist ein [Budget](help:governor) gesetzt, zeigt das Panel vor dem Start die Schätzung des Laufs gegen den Rest; ein Lauf hält an der Zeile, die die Linie reißen würde (**+1 $ einmal** geht weiter, **Stopp** beendet ihn). Zeilen, die das automatische Aktualisieren füllen würde, warten *pausiert* — auch über ein Neuladen — und werden gefüllt, wenn das Budget steigt, ein neuer Tag beginnt oder mit **E** im Panel.

> Autofill nutzt deinen eigenen Claude-Schlüssel; Anthropic rechnet die Nutzung darüber ab. Gesendet werden nur die Einträge, die gefüllt werden.
