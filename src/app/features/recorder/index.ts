/**
 * Flight recorder (Flugschreiber) — public API. R1a: the journal (writers, records, pins); the deck,
 * window reading, eject and the ghost follow (design: scratchpad recorder/design.md).
 */
export { startRecorder, stopRecorder } from './journal/recorder'
export { wipeRecorderScope, RECORDER_DB } from './journal/db'
/* the file ids this device's before-images (pins in one-history) hold, per scope — metas only (cloud/device.ts) */
export { pinFileRefs as recorderFileRefs } from '../history/pins'
