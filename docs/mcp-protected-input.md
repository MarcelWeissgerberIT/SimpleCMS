# Protected authentication input from MCP

One recognizes a structured server tool result with `result.interaction` (or a
root `interaction`) containing `type: "url"`, `purpose: "authentication"` and the
protected `/mcp/secure-input/<uuid>` URL. The MCP activity in the editor AI menu
and AI terminal offers **Open protected sign-in**. The result contains no password,
MFA code or browser token.

Only enabled configured MCP servers can show this action. The URL must use the configured server's exact
origin, HTTPS (HTTP only on loopback), the expected path and no credentials, query
or fragment. One never prefetches or embeds the page. A user click opens a separate
server window with `noopener noreferrer`, where the user signs into the server as the
connection owner before entering credentials. There is no password field in the
AI conversation or workspace and no native MCP elicitation dependency.

The MCP server and paired local worker must support protected input. They own
the form, encryption, one-time delivery, expiration and subsequent MFA requests.
One merely displays the credential-free link. Unknown corporate sign-in methods
may still need a visible worker browser. Existing clients can use the same link
without this UI update. Reload One after deploying its updated client, then start
a new AI task if the MCP server configuration changed.
