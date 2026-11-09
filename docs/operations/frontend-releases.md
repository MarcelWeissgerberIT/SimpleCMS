# Frontend releases without disconnecting active work

Recreating the One container interrupts central model calls and receipt saves, as well as collaboration sockets. For **frontend-only changes**, use `scripts/deploy-frontend-live.py`. Do not run `docker compose up`, restart the container, or reload the reverse proxy for this path.

Prepare a local production build, full SHA-256 manifest (`dist/<relative path>` → hash), and a delta tar containing changed `dist/` files and `manifest.json`. Retain a complete local archive for recovery. Upload the delta and this script with its `lib/frontend-publish.cjs` sibling. Pass the expected compose hash, the image currently pinned in compose, a new immutable image tag, source commit, container name and a new release directory. Run as the server operator.

The script locks the compose deployment, checks expected state and archive hashes, builds a new image from the previous image, verifies every frontend file in that image, and refuses a changed backend bundle. It pins the verified image for a future ordinary restart, but **keeps the current container running**. New assets are published before HTML entry points; overwritten files are replaced atomically. Old hashed chunks remain for existing tabs. A write failure rolls back the static changes and restores compose. Container identity and start time must stay identical. No database migration occurs.

After publication, verify public app hash, health, delivered UI and container identity. Probe health throughout the operation. Save the publication manifest and result alongside the release archive. The running container's original image ID may differ from compose's pinned image after a frontend release: the published manifest and `published.json` identify the live frontend; the pinned image restores that same frontend on the next restart.

Keep `compose.before.yml` private (it may contain deployment settings). Keep previous images and complete release archives. Remove only this release's extracted staging tree after validation. A frontend rollback should publish the prior verified files through the same atomic publisher and pin the prior image; do not restart an active backend just to roll back UI files.

Use a separately planned backend release for changes to the server, runtime dependencies, environment, volumes or migrations. This procedure does not make those changes safe to publish without a restart.
