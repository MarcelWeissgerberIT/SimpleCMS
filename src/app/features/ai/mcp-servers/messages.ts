import type { Messages } from '@/shared/i18n'

/**
 * Strings for MCP server codewords (features/ai/mcp-servers: the settings field, the chip next to
 * the AI menu / ⌘K prompt, the note for an addressed server that stayed out). Keys prefixed
 * "features.ai.mcp.cw." — the rest of the MCP server strings live in features/messages-core.ts.
 * Always add both en and de.
 */
export const messages: Messages = {
  en: {
    'features.ai.mcp.cw.label': 'Codeword',
    'features.ai.mcp.cw.hint': 'Start a request with {cw} — Claude then answers with this server’s tools first, even where it is not used otherwise.',
    'features.ai.mcp.cw.hintEmpty': 'Optional. A short word like “kb”: a request starting with kb: then goes to this server first.',
    'features.ai.mcp.cw.use': 'Use {cw}',
    'features.ai.mcp.cw.cardLabel': 'Codeword {cw}',
    'features.ai.mcp.cw.err.format': 'Use a–z, 0–9, - and _ only — no spaces.',
    'features.ai.mcp.cw.err.long': 'At most 24 characters.',
    'features.ai.mcp.cw.err.reserved': '“one” is reserved: it is One’s own codeword in Claude Desktop.',
    'features.ai.mcp.cw.err.taken': 'Another server already has this codeword.',
    'features.ai.mcp.cw.chip': 'Codeword: {names} first',
    'features.ai.mcp.cw.tag.off': 'OFF',
    'features.ai.mcp.cw.tag.token': 'NO TOKEN',
    'features.ai.mcp.cw.note.off': '{server} is switched off — Claude answers without it. Switch it on in Settings → Claude AI.',
    'features.ai.mcp.cw.note.token': 'This browser has no token for {server} — Claude answers without it.',
    'features.ai.mcp.cw.tag.refused': 'TOKEN REJECTED',
    'features.ai.mcp.cw.note.refused': '{server} rejected its token — Claude answers without it. Sign in again or replace the token in Settings → Claude AI → MCP servers.',
  },
  de: {
    'features.ai.mcp.cw.label': 'Codewort',
    'features.ai.mcp.cw.hint': 'Beginne eine Anfrage mit {cw} — dann antwortet Claude zuerst mit den Werkzeugen dieses Servers, auch wo er sonst nicht dabei ist.',
    'features.ai.mcp.cw.hintEmpty': 'Optional. Ein kurzes Wort wie „kb“: Eine Anfrage, die mit kb: beginnt, geht dann zuerst an diesen Server.',
    'features.ai.mcp.cw.use': '{cw} verwenden',
    'features.ai.mcp.cw.cardLabel': 'Codewort {cw}',
    'features.ai.mcp.cw.err.format': 'Nur a–z, 0–9, - und _ — keine Leerzeichen.',
    'features.ai.mcp.cw.err.long': 'Höchstens 24 Zeichen.',
    'features.ai.mcp.cw.err.reserved': '„one“ ist reserviert: Das ist Ones eigenes Codewort in Claude Desktop.',
    'features.ai.mcp.cw.err.taken': 'Ein anderer Server hat schon dieses Codewort.',
    'features.ai.mcp.cw.chip': 'Codewort: zuerst {names}',
    'features.ai.mcp.cw.tag.off': 'AUS',
    'features.ai.mcp.cw.tag.token': 'KEIN TOKEN',
    'features.ai.mcp.cw.note.off': '{server} ist ausgeschaltet — Claude antwortet ohne ihn. Einschalten unter Einstellungen → Claude KI.',
    'features.ai.mcp.cw.note.token': 'Dieser Browser hat kein Token für {server} — Claude antwortet ohne ihn.',
    'features.ai.mcp.cw.tag.refused': 'TOKEN ABGELEHNT',
    'features.ai.mcp.cw.note.refused': '{server} hat sein Token abgelehnt — Claude antwortet ohne ihn. Melde dich neu an oder ersetze das Token unter Einstellungen → Claude KI → MCP-Server.',
  },
}
