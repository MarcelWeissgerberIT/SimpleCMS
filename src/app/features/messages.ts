import { mergeMessages } from '@/shared/i18n'
import { messages as core } from './messages-core'
import { messages as data } from './messages-data'
import { messages as publish } from './messages-publish'

/** features-core: ai, history, share, present, journal · features-data: io, automations, templates, graph · features-publish: website export, protected share links */
export const messages = mergeMessages(core, data, publish)
