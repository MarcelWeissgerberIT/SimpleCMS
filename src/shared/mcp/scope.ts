/** Stateless per-call workspace defaults. Never switch the person's global Atlas tenant. */
export const atlasTenantHint=(tenant:string)=>`Workspace Atlas tenant default: ${tenant}. Use this tenant for Atlas calls unless the person explicitly requests another accessible tenant. Verify identity/access; a different selectedTenant is not proof of missing workspace data. Prefer the per-call tenant argument. Do not change the person's global tenant selection. This default grants no access and does not override project restrictions.`
export function atlasScopedArgs(args:Record<string,unknown>,schema:{properties?:Record<string,unknown>},tenant?:string){
 return tenant&&schema.properties?.tenant&&args.tenant===undefined?{...args,tenant}:args
}
