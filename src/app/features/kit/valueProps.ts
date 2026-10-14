/**
 * Building blocks — the value properties of a database (pure: the kit is passed in). A property of an own type whose
 * type has a `value` script is computed by the kit (recompute.ts) on any row change of its database — remote ones
 * included — in every tab that trusts the code, and the write starts automations, agents' row triggers and autofill:
 * the Patchbay draws such a property as a relay (§1.15, §6 A12) when something listens to it.
 */
import { storedTypeOf } from '../../store/kit'
import type { CustomPropType, Database, Kit, PropertyDef } from '../../store/types'

export interface ValueProp {
  prop: PropertyDef
  type: CustomPropType
  /** the type's value script (One Script code — run only by the kit; readers digest it, never show or run it) */
  code: string
}

/** The value properties of a database: an own type that keeps its stored shape and has a value script. */
export function valuePropsOf(db: Pick<Database, 'properties'>, kit: Kit | null | undefined): ValueProp[] {
  const out: ValueProp[] = []
  for (const prop of db.properties) {
    if (!prop.custom) continue
    const type = kit?.propTypes?.[prop.custom]
    const code = type?.scripts?.value
    if (!type || !code || storedTypeOf(type.base) !== prop.type) continue
    out.push({ prop, type, code })
  }
  return out
}
