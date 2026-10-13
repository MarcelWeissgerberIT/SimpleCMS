/**
 * The person's own line for this browser, written from the UI (Settings › KI, B11): the store-free part (device.ts
 * setDeviceLimit — localStorage) and the device AI stamp of the open workspace in the same press (store stampDeviceGen,
 * under the caller's writer — the person's by default), then the in-tab signal (device.ts DEVICE_EVENT: the brake follows the
 * new line, the cell and the watch re-read it). Other workspaces of this browser are stamped when a tab loads them.
 */
import { useWorkspace } from '../../store/store'
import { withWriter, type Writer } from '../../store/writer'
import { deviceLineChanged, setDeviceLimit, type DeviceLimitResult } from './device'

export function writeDeviceLimit(next: { day?: number | null; month?: number | null } | null, writer: Writer = { kind: 'you', via: 'ui' }): DeviceLimitResult {
  const r = setDeviceLimit(next)
  if (!r.ok) return r
  withWriter(writer, () => useWorkspace.getState().stampDeviceGen())
  // the same tab hears it too (the stamp may not move: a month line added beside a day line)
  deviceLineChanged()
  return r
}
