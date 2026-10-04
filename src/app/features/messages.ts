import { mergeMessages } from '@/shared/i18n'
import { messages as core } from './messages-core'
import { messages as data } from './messages-data'
import { messages as publish } from './messages-publish'
import { messages as importSources } from './messages-import'
import { messages as agent } from './messages-agent'
import { messages as inbox } from './inbox/messages'
import { messages as sync } from './sync/messages'
import { messages as meeting } from './ai/meeting/messages'
import { messages as mcp } from './mcp/messages'
import { messages as templates } from './templates/messages'
import { messages as functions } from './sheets/functions/messages'
import { messages as charts } from './charts/messages'
import { messages as sheets } from './sheets/messages'
import { messages as mail } from './mail/messages'

/** features-core: ai, history, share, present, journal · features-data: io, automations, templates, graph · features-publish: website export, protected share links · features-import: import sources · features-agent: workspace agent · inbox: reminders + inbox engine · sync: folder + GitHub sync · meeting: AI meeting notes · mcp: One MCP (local bridge) · templates: own templates (gallery, save as template, banner) · mail: Gmail → Mails database */
export const messages = mergeMessages(core, data, publish, importSources, agent, inbox, sync, meeting, mcp, templates, functions, charts, sheets, mail)
