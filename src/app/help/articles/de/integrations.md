---
id: integrations
title: Integrationen
section: ai
order: 14
keywords: Integrationen, Integrationsprofil, Profil, freischalten, MCP-Server, passen, Werkzeuge, Rezept, spiegeln, importieren, exportieren, JSON, Schema, one.integration, Schlüssel, nur von Hand, upsert, Werkzeugliste, Agenten-Zustand, Notizen, integrations, profile, unlock, recipe
related: custom-agents, mcp-servers, properties, members-roles
summary: Profile, die Agenten-Funktionen freischalten — Schlüssel, „Nur von Hand“, upsert_rows, Werkzeuglisten, den Agenten-Zustand, Notizen im Posteingang — und Rezepte mitbringen, solange einer deiner MCP-Server passt.
---
Manche Agenten-Funktionen ergeben nur zusammen mit einem anderen Werkzeug Sinn: dessen Einträge über einen Schlüssel in eine Datenbank spiegeln, die eigenen Felder vor Agenten schützen, einen Agenten auf die lesenden Werkzeuge dieses Werkzeugs begrenzen. One baut sie für kein bestimmtes Werkzeug ein. Ein **Integrationsprofil** sagt, für welchen MCP-Server sie gelten, und schaltet sie frei, solange dieser Server da ist. Profile richtest du unter **Workspace → Integrationen** ein.

## Wann ein Profil aktiv ist
Ein Profil ist **auf diesem Gerät aktiv**, wenn einer deiner **eingeschalteten** MCP-Server (**Einstellungen → Claude AI → MCP-Server**) jede Bedingung seines `match` erfüllt:
- `tools` — jedes genannte Werkzeug steht in der Werkzeugliste des Servers aus seinem letzten **Verbindungstest** (ein nie getesteter Server hat noch keine Liste).
- `name` — ein Muster auf den Namen des Servers: `*` steht für beliebige Zeichen, `?` für eines, Groß- und Kleinschreibung zählen nicht (`tracker*`).
- `host` — ein Muster auf den Host seiner Adresse (`*.example.com`).

Mindestens eine Bedingung ist nötig. Die Liste zeigt je Profil eine LED und den Grund: **Aktiv · passt zu TRACKER**, **Inaktiv · kein eingeschalteter MCP-Server bietet list_items**, **Inaktiv · keine Bedingungen** … Darunter zeigt **Auf diesem Gerät freigeschaltet**, was hier gerade an ist.

## Was ein Profil freischaltet
- `keys` — der Schalter **Schlüssel** im Eigenschaftsmenü.
- `onlyByHand` — der Schalter **Nur von Hand** im Eigenschaftsmenü.
- `upsert` — das Werkzeug `upsert_rows` für Agenten und das [KI-Terminal](help:agent).
- `toolAllowList` — die Werkzeugliste je MCP-Server im Agenten-Editor.
- `agentState` — `agent_state_get` / `agent_state_set` zwischen Läufen.
- `notify` — `notify_me`: Notizen eines Agenten in deinem Posteingang.

Ohne aktives Profil werden diese Schalter, Werkzeuge und Bereiche nicht angeboten. Was schon gesetzt ist, **gilt weiter**: Eine Schlüssel-Eigenschaft bleibt eindeutig, Felder „Nur von Hand“ bleiben für jeden Agenten zu (im Eigenschaftsmenü als Markierung zu sehen), und ein Agent mit Werkzeugliste behält sie.

## Rezepte als Einstellung
Ein Profil kann **Rezepte** mitbringen. Solange es aktiv ist, stehen sie unter **Agenten → Neuer Agent**, benannt nach dem Profil. Ein Rezept der Art `mirror` legt eine Datenbank für die Einträge eines anderen Werkzeugs an, ihre Ansichten, eine Berichtsseite und einen geplanten Agenten — alles darin sind Daten: der Name der Datenbank, ihre Eigenschaften (`role`, `name`, `type`, `options`, `key`, `onlyByHand`, `color`, `description`), ihre Ansichten (`type`, `properties`, `groupBy`, `date`, `filter`, `sort`, `colorRules`, `hiddenGroups`, `hideEmpty`) und der Agent (`name`, `schedule`, `write`, `budget`, `model`, `effort`, `tools`, `instructions`). Was ein Rezept weglässt, nimmt die Werte des eingebauten Spiegels — `{ "kind": "mirror" }` allein ist also das Rezept aus [Eigene Agenten](help:custom-agents).

Ein Rezept ohne `instructions` für den Agenten bekommt Anweisungen, die aus **seinen eigenen** Eigenschaften zusammengesetzt sind — nie aus einer, die es nicht hat. Ein Schritt, der zu einer Rolle gehört, kommt nur vor, wenn eine Eigenschaft diese Rolle hat (`link`, `srcStatus`, `srcPriority`, `owner`, `tags`, `changedAt`, `comments`, `lastComment`, `lastCommentAt`, `newComment`, `waiting`, `clarity` mit ihren Optionen, `why`, `gone`); die Schlüssel-Eigenschaft ist die `key_property`; jede Eigenschaft mit `onlyByHand` steht bei „schreibe nie“; jede andere schreibt der Agent wie in der Quelle. Mit den eingebauten Eigenschaften ist das der Text des eingebauten Rezepts.

Texte sind ein Text oder einer je Sprache: `{ "en": "Ready", "de": "Bereit" }`. Ansichten nennen Eigenschaften beim Namen (in einer der Sprachen) oder bei ihrer `role`, Filterwerte nennen Optionen. Im Namen des Agenten, seinen Anweisungen und im Titel der Berichtsseite werden `{db}`, `{server}` und `{report}` eingesetzt; Teile in **[ECKIGEN KLAMMERN]** ersetzt die Person, bevor der Agent eingeschaltet werden kann.

## Das Schema
Ein Profil ist ein JSON-Objekt mit dem Schema `one.integration/1`:

```json
{
  "schema": "one.integration/1",
  "id": "item-tracker",
  "name": "Item tracker",
  "description": "Spiegelt die offenen Einträge unseres Trackers.",
  "match": { "tools": ["list_items", "get_item"], "name": "tracker*" },
  "unlocks": ["keys", "onlyByHand", "upsert", "toolAllowList", "agentState", "notify"],
  "recipes": [
    {
      "kind": "mirror",
      "name": { "en": "Mirror tracker items", "de": "Tracker-Einträge spiegeln" },
      "database": {
        "name": "Einträge",
        "properties": [
          { "role": "name", "name": "Name", "type": "title" },
          { "role": "key", "name": "Eintrag", "type": "text", "key": true },
          { "name": "Stand", "type": "select", "options": [{ "name": "Offen", "color": "yellow" }, { "name": "Bereit", "color": "green" }] },
          { "name": "Meine Notiz", "type": "text", "onlyByHand": true }
        ],
        "views": [
          { "name": "Nach Stand", "type": "board", "groupBy": "Stand", "hideEmpty": true },
          { "name": "Bereit", "type": "table", "filter": { "property": "Stand", "op": "is", "value": "Bereit" } }
        ]
      },
      "agent": { "schedule": { "every": "weekday", "at": "07:30" }, "write": "stage", "budget": 1, "tools": ["list_items", "get_item"] }
    }
  ]
}
```

Dieses Rezept bringt keine `instructions` mit: Sein Agent soll die Einträge auflisten und lesen, *Item* (den Schlüssel) und *State* mit `upsert_rows` schreiben und *My note* nie — sonst nichts.

`id`: Kleinbuchstaben, Ziffern, `-` und `_`. `unlocks`: beliebige der sechs Funktionen. Unbekannte Schlüssel werden abgelehnt, ein Tippfehler fällt also sofort auf. Ein Workspace hat höchstens **50** Profile.

## Neu, importieren, exportieren, bearbeiten
- **Neue Integration → Aus der Vorlage** — der eingebaute Spiegel vollständig ausgeschrieben, mit leerem `match` zum Ausfüllen. **Für einen deiner MCP-Server** füllt `match` mit den getesteten lesenden Werkzeugen dieses Servers und seinem Namen.
- **Importieren** — ein Profil einfügen oder **.json-Datei laden**. Gespeichert wird erst beim Hinzufügen; ein Profil mit einer vorhandenen Kennung ersetzt dieses.
- **Exportieren** — lädt `<id>.integration.json` herunter.
- **Bearbeiten** — das JSON des Profils mit Farben, Zeilennummern und laufender Prüfung: Ein Syntaxfehler nennt Zeile und Spalte, ein Schemaproblem seinen Pfad (`$.recipes[0].database.views[1].groupBy`) und seine Zeile, und die Statuszeile sagt **Gültig · hier aktiv · schaltet frei: … · 1 Rezept**. Ein Klick auf ein Problem springt dorthin; **Formatieren** räumt die Einrückung auf. Ein Profil hat höchstens 200.000 Zeichen: Ein längerer Text erscheint ohne Farben und lässt sich nicht speichern, und mehr als 400.000 eingefügte Zeichen werden nicht übernommen.
- **Löschen** — mit **Rückgängig** in der Meldung.

## Team-Workspaces
Profile gehören zum Workspace und werden mit allen geteilt. **Eigentümer und Admins** fügen sie hinzu, ändern und löschen sie — die Änderung eines anderen setzt der Server zurück; Mitglieder sehen und exportieren sie. Ob ein Profil aktiv ist, hängt weiter von den eigenen MCP-Servern jeder Person ab. [Server-Agenten](help:custom-agents) nutzen stattdessen die MCP-Server des Servers: Dort passt ein Profil über `name` oder `host` (der Server hat keine Werkzeuglisten) und schaltet `upsert_rows` und den Agenten-Zustand für die Server-Agenten des Teams frei. Vollständige Sicherungen enthalten die Profile, Seitensicherungen nie.
