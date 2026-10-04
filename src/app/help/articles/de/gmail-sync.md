---
id: gmail-sync
title: Gmail-Sync
section: mail
order: 1
keywords: gmail, mail, e-mail, google, posteingang, oauth, client-id, mails synchronisieren, labels, ordnen, email, inbox
related: privacy, claude-key, databases, team-cloud
summary: Dein Gmail als Datenbank in One — nur lesend, ab einem Tag deiner Wahl, auf Wunsch von Claude geordnet.
---
One liest Gmail direkt aus diesem Browser — ohne Server dazwischen. Deshalb nutzt du **deinen eigenen Google-Client** (einmalige Einrichtung, ca. 5 Minuten). **Einstellungen → E-Mail** führt dich mit Links hindurch.

## Google-Client einrichten
1. Lege in der **Google Cloud Console** ein Projekt an (Name beliebig).
2. Aktiviere die **Gmail API** für dieses Projekt.
3. Richte den **OAuth-Zustimmungsbildschirm** ein: Zielgruppe *Extern*, im Status *Test* lassen und deine eigene Google-Adresse als Testnutzer eintragen.
4. Erstelle einen **OAuth-Client** vom Typ *Webanwendung* und trage die **Autorisierten JavaScript-Quellen** ein, die One zeigt (z. B. `https://getonecms.com`).
5. Kopiere die **Client-ID** (sie endet auf `.apps.googleusercontent.com`) und füge sie bei **OAuth-Client-ID** ein. Nur die ID — One braucht nie einen Clientschlüssel.

## Verbinden und synchronisieren
**Gmail verbinden** öffnet Googles Fenster; erlaube den Lesezugriff. Dann wählst du:
- **Mails synchronisieren ab** — Mails ab diesem Tag (Standard: vor 30 Tagen),
- **Labels** — z. B. Posteingang; **Spam und Papierkorb überspringen**,
- **Mails pro Durchlauf** und **Wann**: beim Öffnen, alle paar Minuten oder manuell (**Jetzt synchronisieren**).

Die erste Synchronisation legt die Datenbank **Mails** an: Betreff, Von, An, Datum, Labels, ungelesen, Anhänge, ein Gmail-Link — und die Mail selbst als Seite. Die Gmail-LED in ihrem Kopf öffnet diese Einstellungen. Bilder aus dem Web bleiben blockiert, bis du **Bilder laden** klickst. Deine Änderungen an Einträgen bleiben; eine erneute Synchronisation ändert nur Gmails Felder.

## Mit Claude ordnen
Standardmäßig aus. Eingeschaltet (braucht deinen Claude-Schlüssel) bekommt jede neue Mail eine **Kategorie** aus deiner Liste, eine **Priorität**, **Antwort nötig** und eine **Einzeilige Zusammenfassung**, auf Wunsch auch eine Verknüpfung zu einem Eintrag einer Datenbank wie Projekte.

> One liest Gmail nur (Bereich `gmail.readonly`): Eine gelöschte Zeile löscht nie die Mail. Googles Zugriffstoken liegt nur im Speicher dieses Tabs und läuft nach etwa einer Stunde ab. Mail-Inhalte erreichen Anthropic nur, solange **Mit Claude ordnen** an ist. Im Team-Workspace entsteht die Mails-Datenbank in deinem Bereich **Privat**.
