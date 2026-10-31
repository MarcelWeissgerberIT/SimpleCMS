# Atlas Flow in Frankfurt

One L4 (24 GB), `g2-custom-4-32768`, 80 GB balanced disk, `europe-west3-b`.
The trial has a **4-hour maximum runtime and STOP action**, including subsequent starts.
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

Set workspace routes to `{ "p": "local", "m": "one-shared/<host-id>" }` for the supported text features, with no fallback pins. Personal per-feature or per-task choices remain available. Personal MCP opt-in and AJ-Atlas authentication are still required; model sharing never supplies someone else's credentials. Native vision/PDF input and private/mail/memory classes are not supported by this shared channel.

The service profile is in `AtlasFlow.system.txt`. It reuses the local Qwen3-Coder 30B-A3B Q4_K_M weights, while removing personal identities and hard-coded project constraints. The original local model is unchanged. Project constraints must come from actual, authorized sources at runtime.

## Deployment

`bootstrap.sh` uses the official Google Deep Learning VM image with driver 580, Node 24.22.2 (vendor checksum verified), and Ollama 0.40.8. Preserve the exact model creation spec and private host/key files outside Git. Build the host with:

```sh
node deploy/model-service/build-host.mjs /private/staging/one-host.mjs
node --test deploy/model-service/gateway.test.mjs
```

An uploaded root-owned `/opt/atlas-flow` bundle contains the gateway, built host, installer, model creation JSON, hashed key store and private per-workspace presets. `bootstrap.sh` installs systemd services; native worker inference reaches the same gateway through loopback. Keep owner-only permissions on staged bundles and remove transport copies after installation.

The HTTPS proxy uses `handle_path /model/*` to strip `/model` and forward to `10.38.0.10:8081`, with streaming enabled. All other paths retain the normal ONE upstream. Back up and validate Caddy configuration before reloading.

## Keys and operations

```sh
# Key value goes only to the private output file; stdout contains metadata.
node /opt/atlas-flow/keys.mjs create --label "client name" --out /private/client.json
node /opt/atlas-flow/keys.mjs list
node /opt/atlas-flow/keys.mjs revoke --id KEY_ID
```

Create/revoke commands run as root against `/etc/atlas-flow/api-keys.json`; preserve group readability for the gateway (`root:atlas-flow`, 0640). Revocation takes effect on the next request. Already-running requests may finish; stop the gateway to cancel all traffic.

Inspect `atlas-flow-gateway`, `atlas-flow-cnsx`, `atlas-flow-felix` and `ollama` with `systemctl`. `/model/healthz` is gateway liveness only, not model readiness. Check authenticated model inference and ONE model-share status for readiness.

Use `gcloud compute instances stop atlas-flow-frankfurt --project=one-cms-510718 --zone=europe-west3-b` to stop early. A deliberate later start retains the 4-hour cap. Do not remove that cap or schedule repeated starts without authorizing the resulting ongoing costs.

Verify actual GPU offload, peak VRAM, prompt/generation throughput, JSON and function-call output, both encrypted ONE routes, key rejection/revocation, and cross-workspace isolation before calling a deployment ready. Record measurements, not assumed performance.
