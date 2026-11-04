/** A model's claim that a selected tool is missing is not catalogue/connection evidence. */
export function unverifiedMcpDenial(text:string) {
  return /\b(?:atlas|polarion|mcp|tool|werkzeug)/i.test(text)&&/(?:not (?:available|connected)|no (?:access|tools?)|cannot (?:access|connect)|nicht (?:verfügbar|verbunden)|kein(?:e[nsrm]?)? (?:Zugriff|Werkzeug)|nicht.{0,70}(?:verfügbaren Werkzeuge|Liste der verfügbaren))/i.test(text)
}
export const MCP_ATTEMPT_REPAIR='No selected external MCP call has been attempted in this task. A prose claim of missing tools or access is not evidence. Discover the relevant tool on the selected connection with one_mcp_search (connection name or exact tool name), then use the returned nativeFunction and its schema. Execute only the original authorized task; discovery does not authorize new writes, tokens or permissions. If the actual call fails, report that specific blocker. This is the only availability-correction attempt.'
