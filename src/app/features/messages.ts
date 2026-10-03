import { mergeMessages } from '@/shared/i18n'
import { messages as core } from './messages-core'
import { messages as data } from './messages-data'
import { messages as publish } from './messages-publish'
import { messages as importSources } from './messages-import'
import { messages as agent } from './messages-agent'
import { messages as inbox } from './inbox/messages'
import { messages as sync } from './sync/messages'

/** features-core: ai, history, share, present, journal · features-data: io, automations, templates, graph · features-publish: website export, protected share links · features-import: import sources · features-agent: workspace agent · inbox: reminders + inbox engine · sync: folder + GitHub sync */
export const messages = mergeMessages(core, data, publish, importSources, agent, inbox, sync)
