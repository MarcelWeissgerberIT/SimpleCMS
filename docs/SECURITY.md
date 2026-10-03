# Security notes — your keys in the browser

One runs in your browser. The only secrets it keeps there are yours:

| Secret | Where you enter it | Used for |
| --- | --- | --- |
| Claude API key | Settings → Claude AI (or the "Connect your Claude key" card) | requests to `api.anthropic.com` |
| GitHub token | Settings → Sync → GitHub | sync to your own repository on `api.github.com` |

Both are **stored encrypted** in this browser and nowhere else. This page says how, what that protects against — and
what it does not.

Not stored at all: the password of a protected share link (it encrypts the link in the browser and is forgotten). Not
readable by scripts: the team server's sign-in session (an `httpOnly` cookie). API tokens of a team server are shown
once and kept by the server (see [SELF_HOSTING.md](SELF_HOSTING.md)). Webhook URLs and headers of automations are
workspace data, not vault secrets: they travel with the workspace so the automation can run (a backup of a single page
or database strips them).

## How they are stored — the vault

`src/app/lib/vault.ts`, used by `src/app/store/secrets.ts` (Claude key) and `src/app/features/sync/storage.ts`
(GitHub token).

- **One profile key.** On first use, WebCrypto generates a 256-bit AES-GCM key as *non-extractable* and stores the
  `CryptoKey` object in IndexedDB (`one-vault`). Scripts can ask the browser to encrypt or decrypt with it; no script
  — One's included — can read its bytes, and no backup, export or sync carries it.
- **Each secret** is encrypted with AES-GCM under a fresh random 96-bit IV and stored as `s:<workspace>|<name>`. The
  additional authenticated data is `one-vault/1`, the workspace and the name: a record copied to another name or
  workspace does not decrypt, a modified one is rejected.
- **A marker instead of the secret.** The workspace settings and the sync config hold only `vault:<id>:<last 4>` —
  enough to know that a key is set and to show `•••• 1a2B`. That is also all the app state (and its test hook) ever
  shows.
- **On demand, in memory.** The key is decrypted when a request needs it and kept in that tab's memory for the session
  — never written back, never put into the store.
- **Per workspace.** A team workspace has its own copy on this device; one that started with the local workspace's
  settings opens the local key and seals its own copy.
- **Removing.** *Remove* next to the key deletes the sealed record. Signing out with "Also remove the team workspace
  copies", or *Remove this workspace's copy from this browser*, deletes that workspace's sealed secrets. *Reset
  workspace* (Settings → Data) deletes the vault with everything else.
- **Upgrading.** Versions before the vault stored both secrets in plain text. The next start seals them and overwrites
  the plain text where it was stored (the settings record, its repair copy, the sync config).
- **Plain http.** WebCrypto needs a secure context (`https://` or `localhost`). Elsewhere a key you enter works for
  that session only and is not stored; the field says so.

## Where your keys never go

Backups (the key field is blank), Markdown / HTML / PDF exports, published sites, share links, folder and GitHub sync
output, team documents (settings are per device), MCP answers, the workspace agent's prompt, logs and error messages.
The Claude key leaves the browser only in the `x-api-key` header of requests to `api.anthropic.com`, the GitHub token
only in the `Authorization` header of requests to `api.github.com` — both over TLS.

`tests/e2e/vault.spec.ts` checks this end to end: it reads every IndexedDB database of the origin (binary values
included), `localStorage` and `sessionStorage` for the plain text, exports a backup and a share link, migrates an
"older version's" profile, and verifies that the mocked APIs still receive the right key and token.

## What this protects against

- **Leaks through the app's own data.** Backups, exports, share links, sync output, copied records, a storage viewer
  or an IndexedDB dump, a support screenshot of the developer tools: they contain a marker or ciphertext, never the key.
- **Casual reading of the browser's files.** Searching a copied profile, a backup of your home folder or a synced
  profile folder for `sk-ant-` finds nothing.
- **Mix-ups.** A sealed record does not open under another workspace or name.

## What it does not protect against

- **Someone with your browser profile's files and the know-how.** "Non-extractable" means scripts cannot export the
  key — the browser itself still writes the key material into its IndexedDB files, in its own format. Whoever can
  read those files can, with effort, recover the key and decrypt the secrets. What protects files at rest is your
  operating system: full-disk encryption (FileVault, BitLocker, LUKS) and a locked user account.
- **Code running in the page.** A script injected into One (cross-site scripting) or an extension allowed to read and
  change the page can ask the browser to decrypt, exactly as One does — the same holds for every browser app that
  uses an API key. That is why One loads no third-party scripts (everything is bundled, fonts are self-hosted) and the
  team server sends a strict Content-Security-Policy (`script-src 'self'`, `object-src 'none'`, no framing). GitHub
  Pages cannot send that header for the static build.
- **Someone using your unlocked computer.** They can use One — and your key — as you can.

If a key may have leaked, revoke it where it was made: the [Anthropic console](https://console.anthropic.com/settings/keys)
or [GitHub → Fine-grained tokens](https://github.com/settings/personal-access-tokens). Give the GitHub token access to
the one repository you sync, with "Contents: Read and write" only.
