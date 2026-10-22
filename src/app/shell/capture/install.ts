/** React subscription to the shared, early PWA install listener (also used by the website). */
import { useSyncExternalStore } from 'react'
import { getInstallMode, subscribeInstall, type InstallMode } from '../../../shared/install'
export { canOfferInstall, installOne, installGuide, isInstalled, isIOS } from '../../../shared/install'
export type { InstallMode } from '../../../shared/install'

export function useInstallMode(): InstallMode {
  return useSyncExternalStore(subscribeInstall, getInstallMode, getInstallMode)
}
