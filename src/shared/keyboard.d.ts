export interface KeyboardNavigator {
  userAgentData?: { platform?: string }
  platform?: string
  userAgent?: string
}
export interface KeyboardLabels {
  os: 'mac' | 'windows' | 'other'
  isMac: boolean
  label(keys: string): string
  text(value: string): string
}
export function createKeyboardLabels(nav?: KeyboardNavigator): KeyboardLabels
