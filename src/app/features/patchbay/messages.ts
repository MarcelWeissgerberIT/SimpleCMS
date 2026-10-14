import { mergeMessages, type Messages } from '@/shared/i18n'
import { messages as fuses } from './messages-fuses'
import { messages as setup } from './messages-setup'
import { messages as live } from './messages-live'
import { messages as patch } from './messages-patch'
import { messages as hint } from './messages-hint'

/**
 * Patchbay strings (features/patchbay) — the page frame, the rack, the readout (B1 placeholder, B6 the rest). Keys
 * "features.patchbay.*"; always add both en and de. UI names: EN "Patchbay", DE "Schaltplan" (plan §1.1: no
 * "Vertrauen", "Prüfschritt", "abnehmen", "fremd", "Trigger"; "Ausgang" only for the real Outbox). The per-batch files
 * (fuses · setup · live · patch · hint) are merged here — the features registry imports only this one.
 */
const page: Messages = {
  en: {
    'features.patchbay.title': 'Patchbay',
    'features.patchbay.sub': 'What runs by itself',
    'features.patchbay.asList': 'As list',
    'features.patchbay.asListTitle': 'Workspace settings → Automation',
    'features.patchbay.ro.aria': 'The patchbay at a glance',
    'features.patchbay.ro.agents': 'Agents',
    'features.patchbay.ro.scripts': 'Scripts',
    'features.patchbay.ro.automations': 'Automations',
    'features.patchbay.ro.commands': 'Commands',
    'features.patchbay.ro.repeating': 'Repeating',
    'features.patchbay.ro.databases': 'Databases',
    'features.patchbay.wiring.label': '§ 00 — Wiring',
    'features.patchbay.wiring.text':
      'Here everything that runs by itself gets drawn as one rack: agents, automations, scripts, MCP servers, pipelines — with every cable between them, and a fuse on each path that could carry private data out.',
    'features.patchbay.wiring.parts': '{n} parts run or are wired to run by themselves.',
    'features.patchbay.wiring.parts.one': '{n} part runs or is wired to run by itself.',
    'features.patchbay.wiring.none': 'Nothing runs by itself yet.',
  },
  de: {
    'features.patchbay.title': 'Schaltplan',
    'features.patchbay.sub': 'Was von allein läuft',
    'features.patchbay.asList': 'Als Liste',
    'features.patchbay.asListTitle': 'Workspace-Einstellungen → Automatisierung',
    'features.patchbay.ro.aria': 'Der Schaltplan auf einen Blick',
    'features.patchbay.ro.agents': 'Agenten',
    'features.patchbay.ro.scripts': 'Skripte',
    'features.patchbay.ro.automations': 'Automationen',
    'features.patchbay.ro.commands': 'Befehle',
    'features.patchbay.ro.repeating': 'Wiederkehrend',
    'features.patchbay.ro.databases': 'Datenbanken',
    'features.patchbay.wiring.label': '§ 00 — Verdrahtung',
    'features.patchbay.wiring.text':
      'Hier wird alles, was von allein läuft, als ein Rack gezeichnet: Agenten, Automationen, Skripte, MCP-Server, Pipelines — mit jedem Kabel dazwischen und einer Sicherung auf jedem Weg, auf dem private Daten nach außen gelangen könnten.',
    'features.patchbay.wiring.parts': '{n} Teile laufen von allein oder sind dafür verdrahtet.',
    'features.patchbay.wiring.parts.one': '{n} Teil läuft von allein oder ist dafür verdrahtet.',
    'features.patchbay.wiring.none': 'Noch läuft nichts von allein.',
  },
}

export const messages: Messages = mergeMessages(page, fuses, setup, live, patch, hint)
