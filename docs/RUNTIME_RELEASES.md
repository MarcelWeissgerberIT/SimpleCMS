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


## 2026-11-06 · Document-stage source checks

Frontend source `c05116f7` corrects the One-model document pipeline's source contract: required One page reads no longer imply a mandatory Atlas read merely because Atlas is connected. Explicit profile-required Atlas evidence remains enforced. Editor-generated block IDs no longer invalidate an unchanged source snapshot; genuine source edits still stop stale results. Failed stages retain previously saved analysis and provide a readable missing-source explanation.

- The prior live bundle reproduced `Compiled result check blocked: task_sources_observed` with synthetic provider/MCP fixtures. Eleven browser checks, 36 unit checks, TypeScript, WASM artifact verification and the production build passed. Desktop/mobile light/dark views were inspected. The user's paid BA run was not restarted.
- Image: `one-workshop:ba-sources-c05116f7`; archive SHA-256: `a7e2c7525d38d0e2250bb38d5999b91fd8271dd8a79c2bc65dab15947c7ee937`.
- Public entry SHA-256: `0b8ca8e8e680995c8c408b84acc2ac0cdfbefcd433f09a3fe9687b368cb792aa`.
- All 1,585 release-manifest files verified in the image and running container. Public app HTML and 88 referenced JS/CSS assets hash-verified over HTTPS; health passed and schema minimum remains 6.
- Backend SHA-256 remains `b670150d8b2678218a0c9d655a1e58b511a35fa289798be54f9adb665576278d`. Atomic frontend publication retained compatibility assets and the existing container start time (`2026-11-06T12:18:51.708916279Z`). Compose pins the new runtime for future starts.
- Rollback HTML and compose: `/opt/one/rollback-ba-sources-c05116f7`. Only redundant `dist`, `static-assets` and `entries` folders from the previous release staging directory were removed, after every file matched its retained SHA-256-verified archive. Data, volumes, release archives and rollback images remain intact. Final free server space: 604 MB.

## 2026-11-06 · Evidence-led code analysis

Frontend source `ef2a8254` adds the native `/code-analysis` block: scoped, read-only Atlas investigation using the One model, with four durable phases, supporting and contradicting evidence, source-linked flows, requirement/test-source mapping, explicit review and version acceptance. New snapshot investigations retain earlier evidence and compare stable findings. The Atlas code-analysis template now includes the same investigation method. Own run budgets now apply without a workspace budget and retain previously spent amounts between rounds.

- Twenty code-analysis/source-reference browser checks, four existing governor regressions, twenty unit checks, TypeScript and the production build passed. Desktop/mobile light/dark layouts and the changelog screenshot were visually inspected. Provider and Atlas calls used synthetic fixtures; no paid/private investigation was started.
- Image: `one-workshop:code-analysis-ef2a8254`; archive SHA-256: `647f11d7fb9f6ac50b2d44dbc894cf6ec2b801bd8349d71913ca347b681ad060`.
- Public entry SHA-256: `0ced845a1aaaa3da939c048905c3dea803901969e8b7c80aaa4664a68bd21b47`.
- All 1,747 release-manifest files verified in the new image and running container. Public app HTML and 88 referenced JS/CSS assets hash-verified over HTTPS. Health passed; schema minimum remains 6.
- Backend SHA-256 remains `b670150d8b2678218a0c9d655a1e58b511a35fa289798be54f9adb665576278d`. Atomic frontend publication retained compatibility assets and the container start time (`2026-11-06T12:18:51.708916279Z`). Compose pins the new runtime.
- Rollback HTML and compose: `/opt/one/rollback-code-analysis-ef2a8254`. Duplicate `dist`, `static-assets` and `entries` folders from the prior and current staging directories were removed only after matching every file against their retained hash-verified release archives. Data, volumes, archives and rollback images were retained. Final free disk: 524 MB.

Source authenticity and model interpretation remain distinct. Test references identify source code, not executed tests. Scope and flow reports are bounded model investigations, not compiler-derived completeness proofs. Actual provider cost may exceed a pre-request estimate by the current response; completed phases survive a budget hold or error.


## 2026-11-07 · Work overview and recoverable analysis costs

Frontend source `a80a69f3` adds a unified work overview in the AI terminal, saved evidence relationships and visible gaps, editable reusable analysis recipes, scope/cost preflight, readable activity and error recovery. Terminal recovery records now retain progress and known costs. One-model document stages retain failed/interrupted usage receipts without replaying writes or advancing unfinished stages. Source-reference subpages remain optional.

- 27 targeted browser checks passed, covering overview navigation, individual change acceptance, recipe save/run with fresh reads and a new decision, pipeline recovery and code-analysis evidence/version controls. TypeScript, production build and both CI container checks passed. Desktop/mobile light/dark layouts were inspected. Provider/Atlas regression replies used synthetic fixtures.
- Image: `one-workshop:workflow-a80a69f3`; archive SHA-256: `334141079bafda4a5670b258872c8ca0741052ad8a4b512b3eb53c7afa331d4f`.
- Public app entry SHA-256: `e3d58a341d6c117e7d64d51e0c61b1594437f6304de0ab128015c73ae9b0a733`. All 964 manifest files matched in the image and running container; public HTML and 89 referenced JS/CSS assets matched over HTTPS. Health returned `ok: true`.
- Backend SHA-256 remains `dfdea51e9b231cd120d0f96939a3e787a6bacd6f3bfc4e93f98f50dbe73430b8`. Assets were published before atomic HTML replacement. Existing hashed assets remain available and container start time stayed `2026-11-06T18:40:23.686960414Z`. Compose pins the verified image for future starts.
- Rollback HTML and compose: `/opt/one/rollback-workflow-a80a69f3`. Limited disk headroom required an approximately 12 MB frontend delta layer over the prior pinned `one-workshop:conversion-1437f030` image; the existing backend and compatibility assets were verified and retained.
- An isolated local workspace on the public production site passed Markdown import, finding filtering, evidence/requirement/gap display, desktop/mobile layout, read-only recipe preparation with a fresh decision, original-block navigation and reload. No model calls or writes to the user's workspace were made. Live proof and screenshots are under `/Users/marcelweissgerber/Documents/Playground/artifacts/one-workflow-*20261107*`.

Cost preflight estimates known text, not a complete run or hard cap; the existing budget governor remains authoritative. Reusable document-analysis recipes freshly read their One sources; a new repository investigation still uses the code-analysis block. Local terminal recovery retains its existing 24-hour lifetime.


## 2026-11-07 · Active task across page and terminal switches

Frontend source `3ebfecaf` keeps the terminal task visible in a compact page dock while the terminal is collapsed, retaining its original context when navigating elsewhere. It reports running/waiting/completed states and returns to the current activity, decision controls or answer without changing the open page. A fixed terminal task header, explicit result jump and paused-following indicator improve orientation through longer history. Completion toasts account for the compact dock on mobile.

- 23 targeted browser checks passed (22 in the final combined run plus the decision-return regression after respecting the existing 350 ms accidental-key guard). Existing root-hosted frontend specs now explicitly mock team-server boot endpoints. TypeScript, production build and dispatched container CI run `42369520531` passed. Desktop/mobile light/dark layouts and public screenshots were inspected.
- Image: `one-workshop:active-3ebfecaf`; release archive SHA-256: `67acebbb2bd6ee105819bd669d1e0ae5dcd3f1d10e4104276d19fe2423197f85`.
- Public entry SHA-256: `0398863781177284698031157e9745ebde1fc13ab1293f57f913fdcfe6a48cbd`. All 964 manifest files matched in the new image and running container; public HTML and 89 referenced JS/CSS assets matched over HTTPS. Health returned `ok: true`.
- Backend SHA-256 remains `dfdea51e9b231cd120d0f96939a3e787a6bacd6f3bfc4e93f98f50dbe73430b8`. Atomic frontend publication retained compatibility assets and the running container's start time. Compose pins the new runtime; rollback HTML and compose are at `/opt/one/rollback-active-3ebfecaf`. A frontend delta layer over `one-workshop:workflow-a80a69f3` preserves disk headroom.
- Public production UI verified with an isolated local workspace: import source, fake-key setup via UI, intercepted synthetic read/answer responses, navigate to a different page while running, retain original context, complete in the background, then return to the focused result on a mobile viewport without changing the page. No paid provider calls or user-workspace writes. Proof and screenshots: `/Users/marcelweissgerber/Documents/Playground/artifacts/one-active-work-live-*20261107*`; hash proof: `one-active-public-hashes-20261107.json` in the same directory.
- Only verified redundant current-release `dist`/`delta` build directories were removed. Archive, manifest, rollback, images and user data retained; final free space 627,073,024 bytes.


## 2026-11-07 · Page navigation from the AI terminal

Frontend source `6833e11e` adds **Switch page / Seite wechseln** beside the terminal title. It opens the existing search/recent-pages picker and folds the terminal away. Navigating to another page through the sidebar or keyboard search also makes room for that page; same-page anchors leave the terminal open. The background task, original context and unsent input remain intact. Terminal teardown respects focus already claimed by the page picker.

- TypeScript, production build and all 24 targeted terminal/workflow browser checks pass. The picker-focus regression was reproduced with a focused page editor on desktop and mobile before the fix, then verified passing.
- Public production UI passed desktop page search while a synthetic task was running, mobile page search from the full-screen terminal, original-context preservation, background completion and focused result return. The isolated local test workspace used intercepted provider responses: no paid calls or writes to the user's workspace. Proof/screenshots: `/Users/marcelweissgerber/Documents/Playground/artifacts/one-navigation-live-*20261107*`.
- Image: `one-workshop:navigation-6833e11e`; archive SHA-256: `011705efe4ec79a78ccc384f6c0995ac18877e8c9f55dd3be4542bd8d680c2b8`. Public entry SHA-256: `d203d25f208addd3b75ca8c00f8251656e4921e0c69587b5d70ebfe3f0439b15`. All 964 manifest files matched in the image and running container; public HTML and 89 referenced assets matched over HTTPS; health was `ok: true`.
- Frontend assets published atomically without restarting the container. Backend SHA-256 remains `dfdea51e9b231cd120d0f96939a3e787a6bacd6f3bfc4e93f98f50dbe73430b8`. Compose pins the verified image. Rollback HTML/compose: `/opt/one/rollback-navigation-6833e11e`; the prior fully verified release is also retained at `/opt/one/rollback-navigation-5a049dd9`.
- Only checksum-verified redundant release build directories were removed. Archives, manifests, rollback data, compatibility assets and user data retained. Final free space: 505,225,216 bytes.
