import type { Messages } from '@/shared/i18n'

/**
 * Strings of the Regler (governor: budgets, the red line, holds). Keys "features.governor.*", always en and de. Plurals:
 * `.one` / `.other`. Glossary (EN / DE): governor / Regler · usage / Verbrauch · red line / Rotlinie · receipt / Beleg ·
 * saving rule / Sparregel · ceiling / Decke · pre-run / Vorlauf · day budget / Tagesbudget · held / angehalten.
 */
export const messages: Messages = {
  en: {
    // the lines (Binding): what held or binds
    'features.governor.binding.day': 'day budget',
    'features.governor.binding.month': 'month budget',
    'features.governor.binding.device-day': 'your day limit in this browser',
    'features.governor.binding.device-month': 'your month limit in this browser',
    'features.governor.binding.run': 'budget per run',

    // agent runs the Regler held (status 'held')
    'features.governor.status.held': 'Held',
    'features.governor.run.held.title': 'Held by the governor',
    'features.governor.run.stopped.day': 'Stopped at the red line (day budget {budget}) — proposals so far wait for you',
    'features.governor.run.stopped.month': 'Stopped at the red line (month budget {budget}) — proposals so far wait for you',
    'features.governor.run.stopped.device-day': 'Stopped at the red line (your day limit in this browser, {budget}) — proposals so far wait for you',
    'features.governor.run.stopped.device-month': 'Stopped at the red line (your month limit in this browser, {budget}) — proposals so far wait for you',
    'features.governor.run.stopped.run': 'Stopped at the budget per run ({budget}) — proposals so far wait for you',
    'features.governor.run.stopped.noprice': 'Stopped: no price for the next step, so the budget cannot be kept — proposals so far wait for you',
    'features.governor.run.stopped.scope': 'Stopped: the account was still loading, so the budget could not be checked — proposals so far wait for you',
    'features.governor.run.notStarted.today': 'Today {count} × not started',
    'features.governor.run.notStarted.past': '{count} × not started that day',
    'features.governor.run.notStarted.why.day': 'the day budget is used up ({spent} of {budget}).',
    'features.governor.run.notStarted.why.month': 'the month budget is used up ({spent} of {budget}).',
    'features.governor.run.notStarted.why.device-day': 'your day limit in this browser is used up ({spent} of {budget}).',
    'features.governor.run.notStarted.why.device-month': 'your month limit in this browser is used up ({spent} of {budget}).',
    'features.governor.run.notStarted.why.run': 'the first step does not fit the budget per run ({budget}).',
    'features.governor.run.notStarted.why.noprice': 'no price for the model — the budget cannot be kept.',
    'features.governor.run.notStarted.why.scope': 'the account was still loading.',
    'features.governor.run.notStarted.line': '{count}: {why} Next run as planned.',
    'features.governor.run.notStarted.times': 'Held at {times}',
    'features.governor.run.held.state': 'State not saved — the next run starts from the old state; its proposals replace these where they touch the same rows',
    'features.governor.run.pruned.one': '1 older proposal removed',
    'features.governor.run.pruned.other': '{count} older proposals removed',
  },
  de: {
    'features.governor.binding.day': 'Tagesbudget',
    'features.governor.binding.month': 'Monatsbudget',
    'features.governor.binding.device-day': 'deine Tagesgrenze in diesem Browser',
    'features.governor.binding.device-month': 'deine Monatsgrenze in diesem Browser',
    'features.governor.binding.run': 'Budget pro Lauf',

    'features.governor.status.held': 'Angehalten',
    'features.governor.run.held.title': 'Vom Regler angehalten',
    'features.governor.run.stopped.day': 'An der Rotlinie angehalten (Tagesbudget {budget}) — bisherige Vorschläge warten auf dich',
    'features.governor.run.stopped.month': 'An der Rotlinie angehalten (Monatsbudget {budget}) — bisherige Vorschläge warten auf dich',
    'features.governor.run.stopped.device-day': 'An der Rotlinie angehalten (deine Tagesgrenze in diesem Browser, {budget}) — bisherige Vorschläge warten auf dich',
    'features.governor.run.stopped.device-month': 'An der Rotlinie angehalten (deine Monatsgrenze in diesem Browser, {budget}) — bisherige Vorschläge warten auf dich',
    'features.governor.run.stopped.run': 'Am Budget pro Lauf angehalten ({budget}) — bisherige Vorschläge warten auf dich',
    'features.governor.run.stopped.noprice': 'Angehalten: kein Preis für den nächsten Schritt, das Budget kann nicht gehalten werden — bisherige Vorschläge warten auf dich',
    'features.governor.run.stopped.scope': 'Angehalten: das Konto wurde noch geladen, das Budget ließ sich nicht prüfen — bisherige Vorschläge warten auf dich',
    'features.governor.run.notStarted.today': 'Heute {count} × nicht gestartet',
    'features.governor.run.notStarted.past': 'An diesem Tag {count} × nicht gestartet',
    'features.governor.run.notStarted.why.day': 'Tagesbudget aufgebraucht ({spent} von {budget}).',
    'features.governor.run.notStarted.why.month': 'Monatsbudget aufgebraucht ({spent} von {budget}).',
    'features.governor.run.notStarted.why.device-day': 'deine Tagesgrenze in diesem Browser ist aufgebraucht ({spent} von {budget}).',
    'features.governor.run.notStarted.why.device-month': 'deine Monatsgrenze in diesem Browser ist aufgebraucht ({spent} von {budget}).',
    'features.governor.run.notStarted.why.run': 'der erste Schritt passt nicht ins Budget pro Lauf ({budget}).',
    'features.governor.run.notStarted.why.noprice': 'kein Preis für das Modell — das Budget kann nicht gehalten werden.',
    'features.governor.run.notStarted.why.scope': 'das Konto wurde noch geladen.',
    'features.governor.run.notStarted.line': '{count}: {why} Nächster Lauf wie geplant.',
    'features.governor.run.notStarted.times': 'Angehalten um {times}',
    'features.governor.run.held.state': 'Stand nicht gespeichert — der nächste Lauf beginnt beim alten Stand; seine Vorschläge ersetzen diese, wo sie dieselben Zeilen betreffen',
    'features.governor.run.pruned.one': '1 älterer Vorschlag entfernt',
    'features.governor.run.pruned.other': '{count} ältere Vorschläge entfernt',
  },
}
