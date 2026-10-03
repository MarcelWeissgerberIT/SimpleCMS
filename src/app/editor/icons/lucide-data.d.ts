/**
 * lucide-react ships one ES module per icon (dist/esm/icons/<name>.mjs) that exports the icon's
 * raw data next to its component. icons/glyphSet.ts imports only that data.
 */
declare module 'lucide-react/dist/esm/icons/*.mjs' {
  import type { LucideIconData } from 'lucide-react'
  export const __iconData: LucideIconData
}
