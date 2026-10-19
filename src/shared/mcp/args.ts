/**
 * One MCP — strict arguments at every depth (spec § 2.0), pure: an object the contract closes
 * (`additionalProperties: false`) takes only the keys it declares, also inside a list or another object — `rows[0].Status`
 * (a property written next to `properties`), `pages[2].content`, `inline.afterblock`, `views[0].group_by`. Such a key is
 * refused, never dropped: the call would otherwise "succeed" without what the agent meant (a row without its values, a
 * board at the end of the page). Open maps (a row's `properties`) take any key. The team server's schemas are strict
 * objects at every depth too (server/src/mcp/tools.ts — server/test/mcp-parity.test.ts compares them with this contract).
 */

type Schema = Record<string, unknown>

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** The variants a schema allows (anyOf / oneOf), or the schema itself. */
function variants(s: Schema): Schema[] {
  const list = (Array.isArray(s.anyOf) ? s.anyOf : Array.isArray(s.oneOf) ? s.oneOf : null) as Schema[] | null
  return list?.length ? list.flatMap(variants) : [s]
}

const types = (s: Schema): string[] => (Array.isArray(s.type) ? (s.type as string[]) : typeof s.type === 'string' ? [s.type] : [])
const objectSchema = (s: Schema) => types(s).includes('object') || isObj(s.properties)
const arraySchema = (s: Schema) => types(s).includes('array') || isObj(s.items)

/** A path as the contract writes it: `rows[3].properties`. */
const join = (path: string, key: string | number) => (typeof key === 'number' ? `${path}[${key}]` : path ? `${path}.${key}` : key)

export interface Undeclared {
  /** where: `rows[0].Status` */
  path: string
  /** the object it sits in (`rows[0]`) and the keys that object takes */
  at: string
  key: string
  takes: string[]
}

/**
 * The first key inside `value` (at `path`) that `schema` does not declare where it is closed — null when everything fits.
 * Values of the wrong type are left to the tool's own checks (they answer with what is expected).
 */
export function undeclaredIn(value: unknown, schema: Schema | undefined, path = ''): Undeclared | null {
  if (!schema || value === null || value === undefined) return null
  const all = variants(schema)
  if (Array.isArray(value)) {
    const s = all.find(arraySchema)
    const items = s && isObj(s.items) ? (s.items as Schema) : null
    if (!items) return null
    for (let i = 0; i < value.length; i++) {
      const hit = undeclaredIn(value[i], items, join(path, i))
      if (hit) return hit
    }
    return null
  }
  if (!isObj(value)) return null
  const s = all.find(objectSchema)
  if (!s) return null
  const props = (isObj(s.properties) ? s.properties : {}) as Record<string, Schema>
  for (const [k, v] of Object.entries(value)) {
    if (Object.hasOwn(props, k)) {
      const hit = undeclaredIn(v, props[k], join(path, k))
      if (hit) return hit
    } else if (s.additionalProperties === false) {
      return { path: join(path, k), at: path, key: k, takes: Object.keys(props) }
    } else if (isObj(s.additionalProperties)) {
      const hit = undeclaredIn(v, s.additionalProperties as Schema, join(path, k))
      if (hit) return hit
    }
  }
  return null
}

/** The refusal's "what happened" for a nested key (the caller adds the code, path and next step). */
export const undeclaredText = (tool: string, u: Undeclared): string =>
  u.at ? `${u.at} takes no key ${JSON.stringify(u.key)} (it takes: ${u.takes.join(', ') || 'none'})` : `${tool} takes no argument ${JSON.stringify(u.key)} (it takes: ${u.takes.filter((k) => k !== 'workspace').join(', ') || 'none'})`
