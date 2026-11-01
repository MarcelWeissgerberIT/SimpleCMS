# Runtime releases from clean build artifacts

Use `server/Dockerfile.runtime` when the app and bundled server have already passed their production build and checks. Build the frontend with `npm run build` and the server with `npm --prefix server run build`, using the supported Node runtime. Include only `dist/`, `server/dist/`, the runtime Dockerfile and the three server metadata files it names in the deployment context. Never package a Playwright build with test hooks enabled.

The runtime starts from the official Node 22 slim image, preserves the non-root user, health check and external `/data` volume, and installs no npm dependencies. The bundled server contains its runtime dependencies. This has the same runtime contract as the full multi-stage Dockerfile.

Do not use the previous ONE release as `FROM`. Copying a fresh frontend into its existing asset directory retains old hashed bundles and then stores another full layer on each release. Clean artifacts prevent that accumulation.

Keep one verified rollback release and its encrypted database/file restore point before retiring obsolete build images. Compare the frontend entry file and bundled server hashes with the verified artifacts, check the running container image and `/api/health`, and verify the published worker release manifest. Image/cache cleanup must never remove `/srv/one/data`, files, recovery keys, restore points, Caddy state or Docker volumes. Old deployment archives may move to a separate archive after a hash-verified copy; they contain build artifacts, not workspace data.
