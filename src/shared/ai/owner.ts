/**
 * The owner's decisions (design § 26 and the owner update on Jev) — in ONE place: every reader imports them from here,
 * so changing a decision is a one-line change plus its tests. Delivery order (§ 26.4): one slice after the other,
 * S1 → S2 → … — each ships on its own and never waits for a later one.
 */

export interface OwnerDecisions {
  /** member classes (private, mail, memory, mcp) are the member's own: only the member's allow on their device opens
   *  them, a workspace allow never does (false: they read like shared classes) */
  readonly memberClassesOwnedByMember: boolean
  /** an agent's write never triggers another agent */
  readonly agentTriggers: boolean
  /** an agent writes directly only on the model the person confirmed apply mode on (a router route never is one) */
  readonly directWritesOnConfirmedModelOnly: boolean
  /** a newly set-up provider receives no data until a preset is chosen (setup step 04) */
  readonly newProviderStartsEmpty: boolean
  /** OpenRouter's Jev Router is a visible route option (false: hidden everywhere and refused like any router) */
  readonly jevRouter: boolean
}

export const OWNER: OwnerDecisions = {
  memberClassesOwnedByMember: true,
  agentTriggers: false,
  directWritesOnConfirmedModelOnly: true,
  newProviderStartsEmpty: true,
  jevRouter: true,
}
