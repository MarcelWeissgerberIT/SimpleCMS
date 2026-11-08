# Team hub

The sidebar entry **Team hub** combines knowledge review, team areas, connected search, calendar connections and company identity. Public forms remain in a database form's **Share** dialog. These are additions to One's existing boards, local search, forms and calendar.

## Knowledge review

On a shared page, **Knowledge review** assigns a current editor as responsible person and an optional deadline. The owner of the review or a workspace administrator can verify the exact server-observed page title, content and row properties. The server compares the opened hash before accepting a verification; concurrent review edits use a version precondition. Later content changes make the verification stale, including changes without a corresponding metadata timestamp. Expired and stale reviews appear in the overview and the responsible person's device inbox while One is open (checks every five minutes). A read/archived reminder is not reset by the next check.

Private pages and offline-only local workspaces are not included. Up to 500 tracked pages are listed. The feature does not send email or certify the correctness of prose. Reviews live in the server database, independently of user-editable Yjs metadata.

## Team areas

Open, closed and private areas are actual separate One workspaces linked to a parent. Each has independent documents, files, WebSocket authorization and membership. Open-area joining never upgrades a viewer to editor. Closed areas require an invitation; private areas are listed only to their members. Existing workspace member controls manage invitations and revocation.

Membership is **independent**, not inherited: removing someone from the parent does not remove their separate memberships in areas. Parent deletion removes the directory relationship, not area documents. Workspace and AI settings are likewise independent. There is one hierarchy level; the creation rate is the existing 20 workspaces per person per day. This initial implementation is not a per-page ACL system.

## Connected search

The person chooses connected MCP sources and enters a query. Only that query is sent; no page content or model call is involved. One's local matches are shown alongside source results. MCP sources must offer a discovered read-only search tool with a simple string query and optional result limit. Existing connection credentials, OUT exclusions, allowed tools and data-flow rules still apply. A policy/account/workspace change or cancellation stops result delivery.

Atlas can use the cloud MCP transport. Other connectors use their existing available MCP transport and may require a connected worker. There are no built-in Slack, Teams, Drive or Jira credentials or indexes; those services participate when connected through a compatible MCP search tool. Source-provided titles, excerpts and HTTPS links are displayed; opaque IDs are not turned into invented links. Provider responses remain inspectable, bounded to 40,000 characters and 30 rendered hits.

## Public forms directly into One

Owners and administrators can publish a 30-day link from the form share dialog. Publishing snapshots only the selected questions, choice options, conditional logic and response marker. Question content is encrypted at rest; link tokens are stored only as HMAC. Publishing again invalidates the previous link. Links can be revoked.

A visitor needs no account and can only submit answers; they cannot list database rows, members or hidden properties. The server validates required visible questions, permitted options, types and the current schema. Hidden answers are discarded. Schema changes stop submission until a new link is published. Responses use the normal live database insertion path, including response tracking when configured. A delivery UUID deduplicates retries for 24 hours. The submit response contains no row URL or ID.

Supported direct questions: title/text, number/rating, select/status/multi-select, checkbox, email/phone/URL and date. File uploads, people, relations, custom types, unique-key fields and hand-only fields are deliberately refused at publication. The existing webhook form option remains available. This is a public bearer link: distribute it to the intended respondents; it does not authenticate their identity.

## Company sign-in and calendars

The server uses `openid-client` for OpenID Connect authorization-code validation, with PKCE, state, nonce and a browser-bound HttpOnly cookie. No email-based automatic account linking occurs. A member first signs into One normally and links the company account from the hub. Later they can use company sign-in on the sign-in page. Membership is checked at each use. This release implements **OIDC, not SAML**.

Server administrators configure `ONE_COMPANY_PROVIDERS` as a JSON array in the private server environment, never in a page or frontend bundle:

```json
[{"id":"company-google","label":"Company Google","issuer":"https://accounts.google.com","clientId":"REGISTERED_CLIENT_ID","clientSecret":"REGISTERED_CLIENT_SECRET","workspaceId":"ONE_WORKSPACE_ID","calendar":"google"}]
```

For Microsoft, use a specific tenant issuer `https://login.microsoftonline.com/TENANT_UUID/v2.0`, a confidential web client registration and `"calendar":"microsoft"`. Register exactly `https://YOUR_ONE_HOST/api/company/callback` as the redirect URL. Google uses the same callback. The optional `calendar` field enables the personal calendar connection button. Missing configuration is shown explicitly; no provider account is created or consent silently granted.

Calendar consent requests only Google `calendar.readonly` or Microsoft delegated `Calendars.Read`. Tokens are encrypted under the workspace key and bound to the individual member. Events from the primary calendar are fetched on request for yesterday through the next 30 days, with at most 250 events; truncation is disclosed. Recurrences are expanded by the provider. Provider event links and conference links open externally. The connected-calendar section is also available under **Today**, alongside One's own dated items.

This is read-only, manual refresh. It does not write external events, copy them into team pages or run a background synchronization. Access tokens expire; reconnect to renew. Refresh tokens are not requested or stored. Disconnect deletes One's stored grant; provider-side consent can also be revoked in the provider account. Account linking and a real event fetch require configured provider credentials and user consent, so those live-provider checks are pending on deployments without configuration.

## SCIM provisioning

A workspace owner chooses a configured company provider and generates a SCIM bearer token in Team hub. The token is shown once, stored only as HMAC, replaceable and revocable. Base URL: `/api/v1/scim/WORKSPACE_ID`. Cookie authentication never authorizes SCIM.

Supported resources: Users and Groups; listing/paging; `userName eq`, `externalId eq`, `displayName eq` filters; user create, active replacement, deactivation and deletion; group create, replacement, member add/remove/replace and deletion. Deactivation removes the provisioned workspace membership and memberships in that workspace's provisioned groups, closing active collaborative connections. Re-activation restores group memberships. Users receive member rights, never administrative rights. Administrators and owners must be managed in One.

Provisioned groups get closed, isolated team areas. Removing a group removes managed group memberships and its provisioning mapping, **not** the area's documents. Explicitly existing area membership is retained when only its group assignment is removed; user deactivation removes membership in all provisioned groups. Independent, non-provisioned areas are outside this token's scope. Email/external ID changes require account administration in One; bulk operations and sorting are not supported. A new provisioned user can sign in through email and then link OIDC. SCIM `externalId` is not assumed to equal an OIDC subject.

## Validation

`server/test/team-hub.test.ts` exercises review integrity and concurrency, viewer/outsider isolation, real area membership, conditional form validation, anonymous response privacy, deduplication, link revocation, provider configuration visibility, forged OAuth-state rejection, calendar grant isolation, SCIM groups, deprovisioning/reactivation, administrator protection and token rotation. Existing authentication, workspace and API regression suites also run. Browser validation uses a disposable real One server and separate browser session, never production test hooks or model calls.

Production provider login, provider-specific SCIM onboarding and real calendar fetches remain separate activation checks until credentials and consent are present.
