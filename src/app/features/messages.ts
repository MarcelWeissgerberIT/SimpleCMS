import { mergeMessages } from '@/shared/i18n'
import { messages as core } from './messages-core'
import { messages as data } from './messages-data'

/** features-core: ai, history, share, present, journal · features-data: io, automations, templates, graph */
export const messages = mergeMessages(core, data)
