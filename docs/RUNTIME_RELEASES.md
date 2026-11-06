# Runtime releases from clean build artifacts

Use `server/Dockerfile.runtime` when the app and bundled server have already passed their production build and checks. Build the frontend with `npm run build` and the server with `npm --prefix server run build`, using the supported Node runtime. Include only `dist/`, `server/dist/`, the runtime Dockerfile and the three server metadata files it names in the deployment context. Do not include fixtures, a development build or test-only configuration in the deployment.

Pass the currently serving image as `--build-arg COMPAT_IMAGE=one-workshop:<current-revision>`. Only its immutable `/app/dist/assets` files enter a separate compatibility layer, so an open tab can still load its old lazy chunks. No old HTML or application settings are copied. Do not reload a person's tab with unapplied changes to retire its assets.

The final runtime starts from the official Node 22 slim image, preserves the non-root user, health check and external `/data` volume, and installs no npm dependencies. It checks artifact readability as the runtime user instead of recursively changing modes on immutable assets; that avoids an unnecessary copy-up of the entire asset layer. The bundled server contains its runtime dependencies. This has the same runtime contract as the full multi-stage Dockerfile. For a first installation without a previous image, use that full Dockerfile.

Do not use the previous ONE release as the final stage's `FROM`. Copying a fresh frontend into it stores another full layer of repeated files on each release. A flat compatibility asset layer and clean runtime artifacts preserve client compatibility without inheriting that entire image history. Retire old compatibility assets only after the corresponding clients have moved to a newer build.

Keep one verified rollback release and its encrypted database/file restore point before retiring obsolete build images. Compare the frontend entry file and bundled server hashes with the verified artifacts, check the running container image and `/api/health`, and verify the published worker release manifest. Image/cache cleanup must never remove `/srv/one/data`, files, recovery keys, restore points, Caddy state or Docker volumes. Old deployment archives may move to a separate archive after a hash-verified copy; they contain build artifacts, not workspace data.

## 2026-11-06 · MCP reliability

Frontend source commit `22b78cd3` was built with `BASE_PATH=/` after TypeScript checking, 100 unit checks and 26 browser journeys (synthetic Atlas/provider fixtures). Published image: `one-workshop:mcp-reliability-22b78cd3`. This is a flat `Dockerfile.runtime` image with compatibility assets from the previous release and the exact running backend artifact; no server behavior or document generation changed.

- Archive SHA-256: `cf59f44f020a9a69cfc0c8b08b47fdec384ac9896bdf064a6303da019d0b7769`.
- Public `/app/index.html` SHA-256: `f3e79e2fed9b4a641c963ef5b60a803172b112dc1e00c50df06a175bc8b3759c`.
- Unchanged backend SHA-256: `f4cafb63f2e4c86f9bce228f90c248044f4e7e2961a03a9a0598dfa7336f76f5`.
- 767 manifest files verified inside the running container; public entry HTML and 88 referenced JS/CSS files also hash-verified over HTTPS. Health returned `ok: true`.
- Frontend assets were copied before atomic entry publication; old hashed files remain available to open tabs. Container start time stayed `2026-11-05T13:57:08.4415047Z`.
- Rollback HTML and compose file: `/opt/one/rollback-mcp-reliability-22b78cd3`. Compose pins the verified new runtime for future starts; the currently running container was not restarted.

Disk headroom was checked during image preparation. Only the previous release's redundant `dist` and `static-assets` build folders were removed, after verifying every file against its retained hash-verified release archive. Running assets, rollback images, data volumes and backups were preserved; free space after publication was about 1.6 GB.

## 2026-11-06 · One-model document analysis

Frontend source commit `81154bc7` adds browser-owned document analysis without a local worker. TypeScript, the production build, seven dedicated browser tests and the existing worker-backed business-analysis regression passed. Provider and Atlas calls in these tests used synthetic fixtures. Published image: `one-workshop:analysis-81154bc7`; backend behavior is unchanged.

- Archive SHA-256: `a7f59b5442d7391a91c3543f3f4cbd6f2cd5812bc600f66978725d8e72688e79`.
- Public `/app/index.html` SHA-256: `a80fbde4941dc5fe327bd17fb7b21dc2984ad9d31c3b37faf59896089e895a9b`.
- Unchanged backend SHA-256: `b670150d8b2678218a0c9d655a1e58b511a35fa289798be54f9adb665576278d`.
- All 1,112 manifest files verified in the image and running container; public entry HTML and 88 referenced JS/CSS files hash-verified over HTTPS. Schema minimum remains 6; health returned `ok: true`.
- Frontend entrypoints were replaced atomically after publishing assets. Existing hashed assets remain available, and the container was not restarted. Compose pins the verified runtime for future starts.
- Rollback HTML and compose file: `/opt/one/rollback-analysis-81154bc7-r2`. An earlier publication attempt detected stale HTML caused by copying into an existing staging directory and automatically rolled back; the final deployment used a unique staging directory and passed full verification.

Only hash-verified duplicate build folders and redundant archived release copies were retired to provide build space. Seven old archives were preserved with a SHA-256 manifest at `/Users/marcelweissgerber/Documents/Playground/.one-release-archives/2026-11-06`. Workspace data, Docker volumes and rollback images were preserved. Free server space after publication was about 1.7 GB.

## 2026-11-06 · Read-only Atlas source references

Frontend source `78245d77` adds portable `atlas-code` reference cards, verified read-only source excerpts and finding highlighting. Seven browser journeys (including cloud transport without a worker and Markdown round-trip), ten source-policy/reference unit checks, TypeScript and the production build passed. Browser Atlas replies were synthetic; no private repository analysis was run. Desktop/mobile light/dark views were visually inspected.

- Image: `one-workshop:code-evidence-78245d77`; archive SHA-256: `01adb54aba704d6f3052e3839ccfca0772f3e840e641cd3d41492a91b32fb552`.
- Public entry SHA-256: `ca5965f862d4bbb1b52fb177d417d1b95de92ef51183095493cd04f44fab0b16`.
- All 1,274 manifest files verified in the image and running container; public HTML and 88 referenced JS/CSS assets verified over HTTPS. Health passed and schema minimum remains 6.
- The backend artifact remains `b670150d8b2678218a0c9d655a1e58b511a35fa289798be54f9adb665576278d`. No container restart; old hashed assets retained for open tabs. Compose pins the new runtime image.
- Rollback HTML and compose: `/opt/one/rollback-code-evidence-78245d77`. Final free disk space: about 1.4 GB; no data, volumes or rollback images removed for this release.

## 2026-11-06 · UI Instructions and evidence requests

Frontend source `a6e41711` adds a native UI Studio block (project/Markdown/verified ZIP-part import, component contracts and dependencies, local static HTML measurement and prepared One-model image/document analysis) and source-evidence requests from selected page text. The integration retains the existing code-block schema. Dynamic authenticated URL capture and full HTML/asset archive rendering remain in the local analyzer.

- Fourteen browser journeys, six format/reference unit checks, TypeScript and production build passed. Atlas/provider tests used synthetic fixtures; no paid/private model investigation was executed. Desktop/mobile light/dark layout and the changelog screenshot were visually inspected.
- Image: `one-workshop:ui-studio-a6e41711`; archive SHA-256: `9bf47f06e53cab671cf6cd994bc654b25d253eecc9b118065db8f044ee818371`.
- Public entry SHA-256: `30adbf03201da9b59eb7fa231799381edf04f726a2694016f68cf3196d6b89f7`.
- All 1,436 release-manifest files verified in the new image and running container. Public app HTML and 88 referenced JS/CSS assets hash-verified over HTTPS; health passed and schema minimum remains 6.
- Backend SHA-256 remains `b670150d8b2678218a0c9d655a1e58b511a35fa289798be54f9adb665576278d`. Atomic frontend publication, compatibility assets retained, no container restart (start time remains `2026-11-06T12:18:51.708916279Z`). Compose pins the new runtime.
- Rollback HTML and compose: `/opt/one/rollback-ui-studio-a6e41711`. Free server disk after publication: 894 MB. No data, volumes, archives or rollback images were removed.
