# Atlas Flow in Frankfurt

Initial trial: one L4 (24 GB), `g2-custom-4-32768`, 80 GB balanced disk, `europe-west3-b`.
Weekly replacement after Frankfurt L4 stockouts: `atlas-flow-frankfurt-week`, `n1-highmem-4` (4 vCPU / 26 GiB), one T4 (16 GB), same disk size and model weights, same zone. The snapshot `atlas-flow-week-20261101` preserves the prior installation. The model uses CPU expert offload on T4; do not assume L4 throughput.
The initial trial used a **4-hour maximum runtime and STOP action**. On 2026-11-01 the owner authorized a seven-day test; the VM scheduling cap was changed to **7d, STOP**. A restart still needs available zonal L4 capacity. Confirm RUNNING and model readiness before calling it online.
Stopping retains the disk and its charges. There is no always-on commitment or scheduled restart.
`frankfurt-plan.json` records the dated EUR estimate; recheck prices before making a long-term commitment.

## Boundaries

- Ollama listens on loopback only; cloud-backed models are disabled. Only `atlas-flow:latest` is served.
- The public base URL is `https://onecms.eh-atlas.com/model/v1`. Bearer keys are separate per client, hashed at rest and revocable without restarting.
- Only the ONE proxy's internal IP can reach the gateway. SSH uses IAP. The VM has no Google service account.
- Text inference only: no repositories, Atlas tokens, tools execution, embeddings, image inputs or model-management APIs.
- API clients and the two ONE hosts use one global FIFO, one inference at a time, at most twelve admitted requests. API keys get at most two outstanding requests and thirty requests per minute. Queue wait is bounded to eight minutes; inference to three minutes.
- No prompt or response content is written to gateway logs. Usage metadata is not a GPU cost meter. Hardware costs continue while the VM runs, even when the API is idle.

## ONE integration

CNSx and FeliX each have their own workspace and inference-only host credential. They share compute, not workspace documents, Atlas identities or repository access. Requests and answers use ONE's existing encrypted model-share queue.

Create a dedicated host using an owner/admin session:
`POST /api/workspaces/:id/model-hosts` with `{ "label": "Atlas Flow · Frankfurt" }`.
Its token is returned once. Configure `/api/coding/shared-model/config` with that token, then run the bundled `one-host.ts` entry point. This process only polls the model-share API; it opens neither a coding WebSocket nor a local setup port.

The `model-host` token purpose is distinct from `coding`. Downloading or replacing a personal worker does not revoke the inference host, and the host token cannot access the coding relay. Existing laptop-hosted shares remain compatible.

Set workspace routes to `{ "p": "local", "m": "one-shared/<host-id>" }` for the supported text features, with no fallback pins. Personal per-feature or per-task choices remain available. Personal MCP opt-in and AJ-Atlas authentication are still required; model sharing never supplies someone else's credentials. Prepared AJ workspaces use a workspace-local device overlay, so existing personal defaults and connections stay unchanged. Each member, including the owner, enters a fresh personal token on the start plate. ONE validates it with the real atlas_whoami tool, then offers a read-only first briefing. The fixed AJ endpoint can run through the authenticated ONE server without a local worker; tokens are encrypted on the device and are forwarded only to AJ-Atlas per request, never to the GPU host. The sharedMemberContext flag permits requested private/mail/memory context only after the member’s own opt-in. Native vision/PDF input is unsupported. Local repository access still requires that member’s worker. Prepared-workspace email invite joins go directly to this start page and skip the introductory tour.

The service profile is in `AtlasFlow.system.txt`. It reuses the local Qwen3-Coder 30B-A3B Q4_K_M weights, while removing personal identities and hard-coded project constraints. The original local model is unchanged. Project constraints must come from actual, authorized sources at runtime.

## Deployment

`bootstrap.sh` uses the official Google Deep Learning VM image with driver 580, Node 24.22.2 (vendor checksum verified), and Ollama 0.40.8. Preserve the exact model creation spec and private host/key files outside Git. Build the host with:

```sh
node deploy/model-service/build-host.mjs /private/staging/one-host.mjs
node --test deploy/model-service/gateway.test.mjs
```

An uploaded root-owned `/opt/atlas-flow` bundle contains the gateway, built host, installer, model creation JSON, hashed key store and private per-workspace presets. `bootstrap.sh` installs systemd services; native worker inference reaches the same gateway through loopback. Keep owner-only permissions on staged bundles and remove transport copies after installation.

The HTTPS proxy uses `handle_path /model/*` to strip `/model` and forward to `10.38.0.11:8081`, with streaming enabled. All other paths retain the normal ONE upstream. Back up and validate Caddy configuration before reloading.

## Keys and operations

```sh
# Key value goes only to the private output file; stdout contains metadata.
node /opt/atlas-flow/keys.mjs create --label "client name" --out /private/client.json
node /opt/atlas-flow/keys.mjs list
node /opt/atlas-flow/keys.mjs revoke --id KEY_ID
```

Create/revoke commands run as root against `/etc/atlas-flow/api-keys.json`; preserve group readability for the gateway (`root:atlas-flow`, 0640). Revocation takes effect on the next request. Already-running requests may finish; stop the gateway to cancel all traffic.

Inspect `atlas-flow-gateway`, `atlas-flow-cnsx`, `atlas-flow-felix` and `ollama` with `systemctl`. `/model/healthz` is gateway liveness only, not model readiness. Check authenticated model inference and ONE model-share status for readiness.

Use `gcloud compute instances stop atlas-flow-frankfurt-week --project=one-cms-510718 --zone=europe-west3-b` to stop early. The authorized weekly test has a seven-day runtime cap per start. Do not silently remove or extend that cap, or schedule repeated starts beyond the authorized week. The owner requested full request/answer evaluation visible only to Marcel; frankfurt-plan.json records the proposed audit design. Content logging remains disabled until that design is implemented with test-lead-only access and secret exclusion.

Verify actual GPU offload, peak VRAM, prompt/generation throughput, JSON and function-call output, both encrypted ONE routes, key rejection/revocation, and cross-workspace isolation before calling a deployment ready. Record measurements, not assumed performance.

The weekly VM started at 2026-11-01 06:16:28 UTC; its 7d STOP cap ends around 2026-11-08 06:16:28 UTC (07:16 Berlin). The first T4 response needed warming; a repeated, cached prompt returned 74 output tokens at 19.92 tokens/s in 3.79 seconds. Treat this as a measurement, not a universal latency promise. The weekly compute estimate is EUR 105.68, excluding disk, snapshots, IPv4, egress and tax. Request/answer content logging is still only a proposed design.

## Private Wochentest-Protokolle

Opt-in: `ATLAS_FLOW_AUDIT_TOKEN_FILE` activates encrypted request/response records
at the gateway, including normalized inference payload, raw response, request/job
IDs and receipt/dispatch/completion timestamps. `ATLAS_FLOW_AUDIT_DIR` and
`ATLAS_FLOW_AUDIT_KEY_FILE` must be writable by the gateway user (systemd
`ReadWritePaths=/var/lib/atlas-flow`). No authorization headers are recorded.
Recognized credential fields and bearer/query tokens are redacted, which is not
a universal detector for arbitrary secrets embedded in prose. AES-256-GCM files
use a separate persistent 32-byte key; protect the key and backups independently.
Retention is 30 days with hourly/request-time cleanup. Logs start at activation;
older request bodies cannot be reconstructed. A completed model HTTP response
is transport evidence, not semantic verification or proof of an Atlas commit.

`GET /admin/audit[?before=cursor]` lists pages of 50 metadata records and
`?id=...` retrieves one full record, using a separate long audit bearer token.
Model API keys do not grant log access. ONE proxies this through
`GET /api/workspaces/:id/model-audit[?entry=...|before=...|status=1]`, configured by
`MODEL_AUDIT_URL`, `MODEL_AUDIT_TOKEN` and `MODEL_AUDIT_OWNER` (exact user ID or
email). All three are required together. Only that designated lead may read it,
even if other people administer the workspace. Browser responses are no-store.
`?export=1` streams the entire retained log as JSONL, with an export header and
a final `exportComplete`/record-count line so interrupted downloads are detectable.
In ONE: Settings → AI → Atlas Flow · Frankfurt → My complete test log. Contents
are fetched on demand, never stored in shared documents or browser persistence.
The lead can inspect request/context/raw response and download a JSON record.
