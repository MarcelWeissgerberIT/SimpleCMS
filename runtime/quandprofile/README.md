# QuandProfile · Rust-Kern

Ein mehrdimensionales Profil erzeugt explizite Nachweispflichten. Registrierte
Prüfer erzeugen lokale `EvidenceQuantum`-Datensätze. Der Abschluss ist nur
möglich, wenn jede verpflichtende Anforderung für den aktuellen Stand erfüllt ist.

## Unabhängiger Quantenkatalog

`quantum-catalog.json` definiert wiederverwendbare `QuantumDefinition`-Bausteine
getrennt von einem konkreten Profil. Das Profilformat ist jetzt Schema-Version 3.

Auch Dimensionen werden unabhängig im Katalog definiert (`id`, `title`). Jeder
Quantenbaustein besitzt eine nichtleere Menge von Dimensions-IDs. Beispielsweise
ist der Preisvergleich sowohl in `data` als auch in `outcome` aktiv. Die Auswahl
bindet die gesamte Menge an Profil und Nachweis; eine Prüfung erzeugt dabei
weiterhin genau einen Nachweis. Unbekannte Dimensionsreferenzen und doppelte
Dimensionsdefinitionen sind ungültig. Die bisherige Kerndimension des Prüfers
muss enthalten bleiben. Zusätzliche Dimensionen ordnen dieselbe enge Aussage
weiteren Sichten zu und beweisen keine zusätzlichen Eigenschaften.

Die Auswertung enthält den Gesamtstatus und den Status jeder aktiven Dimension.
Eine Dimension ist nur erfüllt, wenn alle zugehörigen verpflichtenden Pflichten
erfüllt sind. Derselbe Preisnachweis kann also in zwei Dimensionen vorkommen,
ohne als zwei unabhängige Erfolge gezählt zu werden. Änderungen an Zuordnungen
oder verwendeten Dimensionsdefinitionen ändern den Profilhash. Die Reihenfolge
der Dimensionsmenge und unbenutzte Dimensionen ändern ihn nicht.

Es gibt drei verschiedene Objekte:

- **QuantumDefinition:** vorab definierter Prüfbaustein mit ID, Version, exakt
  passendem Selektor und einer Vorlage für einen unterstützten Prüfer.
- **QuantumBinding:** zur Compilerzeit ausgewählter Baustein; das Profil hält
  dessen ID, Version und Inhalts-Hash fest und bindet konkrete Prüfparameter.
- **EvidenceQuantum:** erst zur Laufzeit erzeugtes Ergebnis einer tatsächlichen
  Prüfung, gebunden an Definition, Profil und Datenstand.

Der Compiler selektiert nach normalisierter Regel- oder Zielart, nicht durch
unsichere Ähnlichkeitssuche. Fehlende Definitionen lassen Pflichten offen.
Mehrdeutige Auswahl, unbekannte Prüfer und semantisch unpassende Vorlagen werden
abgewiesen. Die Reihenfolge des Katalogs beeinflusst die Auswahl nicht.
Unbenutzte Definitionen beeinflussen den Profilhash nicht. Ein ausgewählter
Baustein wird eingefroren; spätere Katalogänderungen erfordern Neukompilierung.

Das Binary akzeptiert `--catalog PFAD`; ohne Argument verwendet es den beim
Build eingebetteten Standardkatalog. Die Demo lädt explizit die externe Datei,
sodass unterstützte Definitionen ohne Neubau des Compilers versioniert werden
können. Neue ausführbare Prüfarten benötigen weiterhin vertrauenswürdigen
Rust-Code; die Definitionsdatei führt keinen Code aus. Die heutige Auswahl
unterstützt drei fest definierte semantische Arten und noch keine allgemeine
Prüfplansuche oder Kombination mehrerer Bausteine für eine Pflicht.

Eine Definition sieht beispielsweise so aus:

```json
{
  "id": "data.price-map-equality",
  "version": "1.0.0",
  "selector": "rule:preserve_prices",
  "dimensions": ["data", "outcome"],
  "template": { "kind": "prices_equal", "path": "catalog.json" }
}
```

Die JSON-Datei definiert die Auswahl und Parametrisierung. Ob der Vergleich
erfolgreich ist, wird erst an den tatsächlichen Daten geprüft.

## Ausführen

Rust und Cargo werden benötigt. Der erste Build lädt die in `Cargo.lock`
festgelegten Abhängigkeiten; spätere Builds sind mit lokalem Cache offline möglich.

```sh
cd /Users/marcelweissgerber/Documents/Playground/constraint-compiler
python3 quandprofile_demo.py
cd quandprofile
cargo test --locked
```

Die Demo verbindet den vorhandenen Python-Sprachcompiler mit dem neuen Rust-Kern.
Sie erzeugt `../reports/quandprofile.json`. Kein Modell wird aufgerufen.
Das Rust-Binary kann unabhängig von Python einen JSON-Auftrag von stdin lesen
und einen JSON-Bericht auf stdout schreiben.

## Datenfluss

1. **Contract → QuandProfile:** Übernimmt versionierte Regeln und ihre Quellen.
   Die Dimensionen sind Ergebnis, Daten, Berechtigung und Interpretation.
   Unbekannte Regeln und ungeklärte Aussagen bleiben verpflichtend offen.
2. **Nachweispflichten:** Preiszuordnung erhalten, Veröffentlichung als
   Laufzeitfähigkeit ausgeschlossen und explizites Ergebniskriterium erfüllt.
3. **Prüfer:** Vergleicht die vollständigen Preiszuordnungen, sucht eine konkrete
   Zeichenfolge in einer Datei oder bestätigt die feste Aktionsmenge dieser Laufzeit.
4. **Nachweisquanten:** Enthalten Profilhash, Pflicht-ID, Prüfer und Version,
   Ergebnis, Begründung und Hashes aller für diesen Prüfer verwendeten Dateien.
5. **Auswertung:** Fehlende oder veraltete Nachweise ergeben `open`, ein gültiger
   negativer Nachweis ergibt `violated`. Nur alle gültigen positiven Nachweise
   zusammen ergeben `verified`. Es gibt keinen Durchschnitt oder Punktescore.
6. **Abschluss:** Prüft alle Pflichten erneut und sperrt weitere Aktionen nach Erfolg.

`work_context()` erzeugt eine Modellansicht mit aktuellen Anforderungen,
Prüfkriterien, Status, Profilhash und erlaubten Aktionen. Notwendige Dateibelege
und die Tokenbudgetierung bleiben Aufgabe des Hosts. Eine Verbindung mit dem
echten Frankfurt-Modell ist noch nicht ausgeführt.

## Gültigkeit und Vertrauensgrenze

- Änderungen an einer geprüften Datei machen deren alten Nachweis unpassend.
  Unabhängige Dateiänderungen lassen ihn gültig. Der Preisprüfer bindet sowohl
  Baseline als auch Kandidat. Schon eine reine Umbenennung im Katalog verlangt
  eine erneute Prüfung, auch wenn Preise erhalten bleiben.
- Ein geändertes Profil macht alte Nachweise unpassend, auch bei gleicher
  Vertragsversion, weil der gesamte Profilinhalt gehasht wird.
- Wiederholte identische Prüfungen erzeugen keine doppelten Quanten.
- Der Nachweisspeicher gehört der Laufzeit. Modellaktionen können keine Quanten
  einreichen, Profile ersetzen, Baselines verändern oder Prüfer auswählen.
- Exportierte Quanten dienen der Nachvollziehbarkeit. Sie werden nicht als
  externe Beweise importiert. Die Hashes sind keine Signaturen; die Vertrauensbasis
  ist der lokale, korrekt implementierte Prüfer. Gegen manipulierte Hosts bietet
  diese Version keine kryptografische Attestierung.

## Exakte Aussagegrenzen

Der Ergebnisprüfer beweist nur das Vorkommen einer vorgegebenen Zeichenfolge,
keine visuelle Qualität oder korrekte HTML-Darstellung. Ein HTML-Kommentar kann
dieses enge Kriterium ebenfalls erfüllen. Deshalb heißt die Aussage ausdrücklich
`specified_literal_present_in_target_file`.

Die Zielzeichenfolge wird als explizite `ResultSpec` vom Host hinzugefügt, sie
wird nicht aus „Website überarbeiten“ erfunden. Ohne konkretes Kriterium bleibt
die Zielpflicht offen und der Agent kann die Aufgabe nicht abschließen.

Der Berechtigungsnachweis sagt ausschließlich, dass diese Laufzeit keine
Veröffentlichungs- oder Shell-Aktion anbietet. Er beweist keine vollständige
Deployment-Historie und macht keine Aussage über externe Akteure.

Die Projektdateien liegen isoliert im Arbeitsspeicher. Keine reale Dateisystem-
Sandbox, keine persistente Datenbank, keine allgemeine formale Verifikation,
keine quantenphysikalischen Verfahren. Die Baseline ist der vom Host übergebene
Initialzustand und bleibt während einer Sitzung unveränderlich.

## Tests und Demo-Ergebnis

35 Rust-Integrationstests prüfen unter anderem mehrdimensionale Zuordnung,
unabhängige Dimensionsdefinitionen, Katalogauswahl, Versionierung,
mehrdeutige und semantisch falsche Definitionen, selektive Invalidierung,
Profilwechsel, Wiederholbarkeit, blockierte Fälschungsaktionen, fehlende
Baselines und atomare Ablehnung von Preisänderungen. Zusätzlich bestehen die
bisherigen 26 Python-Tests.

Die geskriptete Demo beginnt offen. Die erste Prüfung entdeckt das fehlende
Ergebnis und ergibt `violated`. Preisänderung und Veröffentlichung werden
abgewiesen. Die erlaubte Überschriftenänderung macht nur den Ergebnisnachweis
veraltet (`open`); nach erneuter Prüfung ist das Profil `verified`. Eine Änderung
an unabhängigen Notizen erhält den Status. Der abschließende Schritt wird
angenommen. Vier eindeutige Nachweisquanten dokumentieren den Verlauf.
