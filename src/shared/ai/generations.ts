/**
 * AI policy generations, by name. A stored rule or limit an older build cannot enforce stamps the generation that
 * enforces it (Workspace.ai.gen / settings.ai.gen); a tab whose build is older refuses every AI request with 'reload'.
 *
 * Each entry is numbered WHEN IT MERGES, in release order — main is linear, so a build that holds generation N holds every
 * one below it. A design names the entry, never the number (whichever slice merges first takes the next one). policy.ts's
 * AI_POLICY_GEN is N only in a build holding every entry numbered ≤ N, and it is raised last in its slice, after every
 * enforcement point. Pure (app + team server).
 */

export const GEN = {
  /** a workspace / device rule limits what Claude may receive (multi-provider S2) */
  claudeLimits: 2,
  /** a day / month budget of the workspace or this browser, or the coding worker governed (Regler G1) */
  budget: 3,
} as const

export type GenName = keyof typeof GEN

/** A generation table as a reader sees it: a later build's entries may be missing here. */
export type GenTable = Readonly<Partial<Record<string, number>>>

/**
 * Each generation → the module that enforces it (the Node test: the file exists and names `GEN.<name>` — an entry up to
 * GEN_UNNAMED_UPTO only has to exist).
 */
export const GEN_ENFORCED: Readonly<Record<GenName, string>> = {
  claudeLimits: 'src/app/features/ai/core/resolve.ts',
  budget: 'src/app/features/governor/install.ts',
}

/**
 * Generations numbered before this table existed: S2 enforces claudeLimits (core/resolve.ts, policy.ts requiredGen) without
 * naming GEN, so the test asks only that its module exists. Every later entry's module names it. Lowered to 1 once the
 * enforcing module reads `GEN.claudeLimits` (Regler B1: policy.ts reads GEN — GEN_ENFORCED.claudeLimits then points there).
 */
export const GEN_UNNAMED_UPTO: number = GEN.claudeLimits
