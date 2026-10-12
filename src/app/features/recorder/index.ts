/**
 * Flight recorder (Flugschreiber) — public API. R1: the journal (writers, records, pins) and the deck (the tape:
 * lanes, flags, zoom, loupe, 24 h strip, playhead, bracket with its meters); R2 window reading; R3 the eject (its
 * marks in the database views); the ghost follows (design: scratchpad recorder/design.md).
 */
export { startRecorder, stopRecorder } from './journal/recorder'
export { wipeRecorderScope, RECORDER_DB } from './journal/db'
/* the file ids this device's before-images (pins in one-history) hold, per scope — metas only (cloud/device.ts) */
export { pinFileRefs as recorderFileRefs } from '../history/pins'
export { RecorderHost } from './ui/RecorderHost'
export { RecorderStatusCell, RewindKey } from './ui/StatusCells'
export { RecorderDataLine } from './ui/DataLine'
export { openRecorder, closeRecorder, toggleRecorder, useRecorderOpen, isRecorderOpen, REWIND_SHORTCUT } from './ui/state'
/* R3: the eject's marks in the database views (a held row, an option that came back) and the database's strip */
export { useRecorderMark, type RecorderMark } from './ui/marks'
export { RecorderDbRead } from './ui/DbRead'
