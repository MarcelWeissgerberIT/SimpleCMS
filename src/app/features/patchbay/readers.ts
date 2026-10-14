/**
 * The app's readers for the wiring inventory (inventory.ts takes them as a parameter so it stays pure): the
 * automations area's and the commands area's own readers, through their public APIs.
 */
import { readAutomations } from '../automations'
import { readDbCommands } from '../commands'
import type { WiringReaders } from './inventory'

export const WIRING_READERS: WiringReaders = { automations: readAutomations, commands: readDbCommands }
