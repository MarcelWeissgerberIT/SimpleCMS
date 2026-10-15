import { mergeMessages, type Messages } from '@/shared/i18n'
import { messages as page } from './messages-page'
import { messages as fuses } from './messages-fuses'
import { messages as setup } from './messages-setup'
import { messages as live } from './messages-live'
import { messages as patch } from './messages-patch'
import { messages as hint } from './messages-hint'
import { messages as wires } from './messages-wires'
import { messages as plate } from './messages-plate'

/**
 * Patchbay strings (features/patchbay): the per-batch files merged — page frame, rack, readout, sidebar row, ⌘K
 * (messages-page.ts, B6) · fuses · setup · live · patch · hint · wires · plate. Keys "features.patchbay.*", always en and
 * de (plan §1.1 words — patchbay-names.spec). The features registry imports only this one.
 */
export const messages: Messages = mergeMessages(page, fuses, setup, live, patch, hint, wires, plate)
