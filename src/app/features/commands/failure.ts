/**
 * A command that could not run: its message goes into an error toast. `action` replaces the toast's
 * "Retry" (e.g. "Mail settings"); null = no action (a retry would repeat what already worked).
 */
export class CommandFailure extends Error {
  action: { label: string; run: () => void } | null | undefined
  constructor(message: string, action?: { label: string; run: () => void } | null) {
    super(message)
    this.name = 'CommandFailure'
    this.action = action
  }
}
