import type { Messages } from '@/shared/i18n'

/**
 * Strings of routing and the AI data rules (multi-provider S2): the data classes (design § 10.1), the route chip and
 * picker, the codeword refusal, the notes a run shows when a data rule left something out, the Jev Router rows, the
 * backup's loosening dialog. Keys "features.ai.cls.*", "features.ai.prov.*", "features.ai.jev.router.*",
 * "features.ai.rules.*". Always add both en and de.
 */
export const messages: Messages = {
  en: {
    'features.ai.cls.public': 'Help & instructions',
    'features.ai.cls.structure': 'Database & field names',
    'features.ai.cls.selection': 'Selected text',
    'features.ai.cls.page': 'Page text',
    'features.ai.cls.rows': 'Database rows',
    'features.ai.cls.files': 'Images & files',
    'features.ai.cls.workspace': 'Many pages',
    'features.ai.cls.people': 'People’s names',
    'features.ai.cls.transcript': 'Meeting transcripts',
    'features.ai.cls.private': 'Private pages',
    'features.ai.cls.mail': 'Mail',
    'features.ai.cls.memory': 'One memory',
    'features.ai.cls.mcp': 'MCP results & tokens',

    'features.ai.prov.codeword.refused': '{cw}: {provider} connects no MCP servers. Nothing was sent.',
    'features.ai.prov.codeword.policy': '{cw}: the AI data rules let {provider} receive no MCP results. Nothing was sent.',
    'features.ai.prov.codeword.askClaude': 'Ask Claude',
    'features.ai.prov.note.selectionOnly': 'Selection only — page text not allowed for this model.',
    'features.ai.prov.note.memoryWithheld': 'Memory not sent (data rule).',
    'features.ai.prov.note.pageWithheld': 'This page not sent (data rule).',
  },
  de: {
    'features.ai.cls.public': 'Hilfe & Anweisungen',
    'features.ai.cls.structure': 'Namen von Datenbanken & Feldern',
    'features.ai.cls.selection': 'Markierter Text',
    'features.ai.cls.page': 'Seitentext',
    'features.ai.cls.rows': 'Datenbankzeilen',
    'features.ai.cls.files': 'Bilder & Dateien',
    'features.ai.cls.workspace': 'Viele Seiten',
    'features.ai.cls.people': 'Namen von Personen',
    'features.ai.cls.transcript': 'Besprechungs-Mitschriften',
    'features.ai.cls.private': 'Private Seiten',
    'features.ai.cls.mail': 'Mails',
    'features.ai.cls.memory': 'One-Gedächtnis',
    'features.ai.cls.mcp': 'MCP-Ergebnisse & Tokens',

    'features.ai.prov.codeword.refused': '{cw}: {provider} verbindet keine MCP-Server. Es wurde nichts gesendet.',
    'features.ai.prov.codeword.policy': '{cw}: Nach den KI-Datenregeln darf {provider} keine MCP-Ergebnisse erhalten. Es wurde nichts gesendet.',
    'features.ai.prov.codeword.askClaude': 'Mit Claude fragen',
    'features.ai.prov.note.selectionOnly': 'Nur die Auswahl geschickt — Seitentext ist für dieses Modell nicht erlaubt.',
    'features.ai.prov.note.memoryWithheld': 'Gedächtnis nicht mitgeschickt (Datenregel).',
    'features.ai.prov.note.pageWithheld': 'Diese Seite nicht mitgeschickt (Datenregel).',
  },
}
