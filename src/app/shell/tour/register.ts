/**
 * Hands the shell's "Try it" actions to the help (imported once by App.tsx). The actions module loads on the
 * first use.
 */
import { registerTry, type ChangelogTry } from '../../help'
import { startTour } from './state'

type Actions = typeof import('./actions')

const lazy = (run: (m: Actions) => unknown) => () =>
  void import('./actions')
    .then((m) => run(m))
    .catch((e) => console.error('[one] a "Try it" action failed', e))

const SHELL_TRIES: Partial<Record<ChangelogTry, () => void>> = {
  tour: () => startTour(),
  slash: lazy((m) => m.trySlash()),
  'ai-menu': lazy((m) => m.tryAIMenu()),
  transform: lazy((m) => m.tryTransform()),
  database: lazy((m) => m.tryDatabase()),
  commands: lazy((m) => m.tryCommands()),
  sheet: lazy((m) => m.trySheet()),
  automations: lazy((m) => m.tryAutomations()),
}

for (const [action, run] of Object.entries(SHELL_TRIES)) registerTry(action as ChangelogTry, run)
