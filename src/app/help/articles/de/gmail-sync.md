---
id: gmail-sync
title: Gmail-Sync
section: mail
order: 1
keywords: gmail, mail, e-mail, google, posteingang, gmail verbinden, oauth, client-id, mails synchronisieren, labels, ordnen, kontakte, firmen, konversationen, anhänge, pdf, email, inbox, contacts, attachments
related: privacy, claude-key, databases, team-cloud
summary: Dein Gmail als Datenbank in One — mit einem Klick verbunden, nur lesend, mit Kontakten, Firmen, Konversationen und Anhängen, wenn du sie brauchst.
---
One liest Gmail direkt aus diesem Browser — ohne Server dazwischen und immer nur lesend (`gmail.readonly`).

## Mit einem Klick verbinden
**Einstellungen → E-Mail → Gmail verbinden.** One bringt seinen eigenen Google-Zugang mit, einzurichten ist nichts. Googles Fenster fragt einmal, welches Konto du nutzt, und nach dem Lesezugriff auf Gmail.

Solange Google den One-Zugang noch prüft, warnt sein Fenster, *Google hat diese App nicht überprüft* — das ist so gewollt: Klicke auf **Weiter**. Während der Prüfung können sich nur Konten verbinden, die der Betreiber freigegeben hat. Alle anderen bekommen von Google eine Absage; One sagt das dann und bietet **Eigenen Google-Client verwenden** an (siehe unten) — oder bitte den Betreiber, deine Adresse einzutragen.

Der One-Zugang funktioniert auf getonecms.com. In einer One-Kopie anderswo — dein eigener Team-Server, ein lokaler Build — zeigt Einstellungen → E-Mail stattdessen die Einrichtung deines eigenen Clients.

## Synchronisieren
Nach dem Verbinden wählst du:
- **Mails synchronisieren ab** — Mails ab diesem Tag (Standard: vor 30 Tagen),
- **Labels** — z. B. Posteingang; **Spam und Papierkorb überspringen**,
- **Mails pro Durchlauf** und **Wann**: beim Öffnen, alle paar Minuten oder manuell (**Jetzt synchronisieren**).

**Jetzt synchronisieren** ist auch einer der [Befehle](help:database-commands) der Mails-Datenbank: die Taste **⌘** an ihrer Zeile in der Seitenleiste, oder ⌘K → *Mails: Jetzt synchronisieren*.

Die erste Synchronisation legt die Datenbank **Mails** an: Betreff, Von, An, Datum, Labels, ungelesen, Anhänge, ein Gmail-Link — und die Mail selbst als Seite. Die Gmail-LED in ihrem Kopf öffnet diese Einstellungen. Bilder aus dem Web bleiben blockiert, bis du **Bilder laden** klickst. Deine Änderungen an Einträgen bleiben; eine erneute Synchronisation ändert nur Gmails Felder.

## Kontakte, Firmen, Konversationen
**Kontakte & Firmen** (standardmäßig an) macht aus Adressen und Thread-Nummern Namen. Die Synchronisation füllt drei verknüpfte Datenbanken neben Mails und verknüpft jede Mail:
- **Kontakte** — einer pro Person, erkannt an der Adresse. Der Name kommt aus der Absenderzeile (`Felix Merz <felix@firma.de>` → Felix Merz). Eine Mail, die du selbst geschickt hast, wird mit dem Empfänger verknüpft.
- **Firmen** — eine pro Domain (*mueller-gmbh.de* → Mueller GmbH). Freemail-Domains wie gmail.com oder gmx.de werden nie eine Firma; die Liste unter **Nie eine Firma** kannst du bearbeiten.
- **Konversationen** — eine pro Gmail-Thread, benannt nach dem Betreff ohne *Re:*, *AW:* oder *Fwd:*.

Benenne einen Eintrag einmal um, und jede Mail zeigt den neuen Namen — erkannt wird immer an den gespeicherten Adressen, Domains und Thread-IDs, nie am Namen. Zwei Einträge für dieselbe Person oder Firma: **Zusammenführen…** in Einstellungen → E-Mail überträgt Adressen, Domains und Verknüpfungen und legt den anderen Eintrag in den Papierkorb, mit Rückgängig. Schaltest du es später ein, werden die früheren Mails in einem Rutsch verknüpft.

## Anhänge
Jede Mail listet ihre Anhänge mit einer Taste **Laden** (und **Alle laden**). Laden holt die Datei aus Gmail in One und setzt sie als echten Block in die Seite: ein PDF im Viewer des Browsers, ein Bild, Audio oder Video, alles andere als Datei zum Herunterladen. HTML-, SVG- und XML-Anhänge gibt es nur zum Herunterladen, angezeigt werden sie nie. Dateien über 25 MB bleiben in Gmail — die Liste verlinkt die Mail.

Eine geladene Datei ist ein Block wie jeder andere: Ihre Taste **KI** fasst ein PDF zusammen, liest seinen Text oder seine Tabellen aus, öffnet eine Word- oder HTML-Datei als Seite, importiert eine CSV- oder Excel-Tabelle als Datenbank — siehe [Claude für Dateien](help:ai-menu). Die Datei erreicht Anthropic nur mit den Claude-Aktionen; die Umwandlungen bleiben auf diesem Gerät.

**Anhänge automatisch laden** (Einstellungen → E-Mail): *Aus* (Standard), *PDFs + Bilder* bis 10 MB oder *Alle* bis 25 MB — für neue Mails. Geladene Dateien bleiben, wenn die Mail erneut synchronisiert wird. Ist Googles Anmeldung abgelaufen, fragt die Taste zuerst nach der Anmeldung.

## Mit Claude ordnen
Standardmäßig aus. Eingeschaltet (braucht [deinen Claude-Schlüssel](help:claude-key)) bekommt jede neue Mail eine **Kategorie** aus deiner Liste, eine **Priorität**, **Antwort nötig** und eine **Einzeilige Zusammenfassung**, auf Wunsch auch eine Verknüpfung zu einem Eintrag einer Datenbank wie Projekte.

## Eigener Google-Client (erweitert)
Für ein eigenes Google-Cloud-Projekt — wenn dein Konto für den One-Zugang noch nicht freigegeben ist oder deine Organisation einen eigenen Client möchte. Öffne in Einstellungen → E-Mail **Eigenen Google-Client verwenden (erweitert)**:
1. Lege in der **Google Cloud Console** ein Projekt an (Name beliebig).
2. Aktiviere die **Gmail API** für dieses Projekt.
3. Richte den **OAuth-Zustimmungsbildschirm** ein: Zielgruppe *Extern*, im Status *Test* lassen und deine eigene Google-Adresse als Testnutzer eintragen.
4. Erstelle einen **OAuth-Client** vom Typ *Webanwendung* und trage die **Autorisierten JavaScript-Quellen** ein, die One zeigt (z. B. `https://getonecms.com`).
5. Kopiere die **Client-ID** (sie endet auf `.apps.googleusercontent.com`) und füge sie bei **OAuth-Client-ID** ein. Nur die ID — One braucht nie einen Clientschlüssel.

Eine eigene Client-ID hat immer Vorrang. **Zurück zum One-Zugang** vergisst sie auf diesem Gerät; die Mails-Datenbank und die Sync-Einstellungen bleiben.

> One liest Gmail nur (Bereich `gmail.readonly`): Eine gelöschte Zeile löscht nie die Mail. Googles Zugriffstoken liegt nur im Speicher dieses Tabs und läuft nach etwa einer Stunde ab. Mail-Inhalte erreichen Anthropic nur, solange **Mit Claude ordnen** an ist. Im Team-Workspace entstehen Mails, Kontakte, Firmen und Konversationen in deinem Bereich **Privat**.
