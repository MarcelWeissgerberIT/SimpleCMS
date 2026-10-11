/**
 * The "Try it" key of the Preflight changelog entry and its card in "What can One do?" (`try: preflight`): Start with
 * the full panel, focus on it. Registered with the help when Preflight starts — loaded lazily: the help's own module
 * imports the features, so a static import here would be a cycle at boot.
 */
import { openPreflight } from './hooks'

export function registerPreflightTry(): void {
  void import('../../help')
    .then(({ registerTry }) => registerTry('preflight', openPreflight))
    .catch((e) => console.warn('[one] preflight: the "Try it" key could not be registered', e))
}
