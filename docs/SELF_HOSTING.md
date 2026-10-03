# Self-hosting SimpleCMS One Cloud

Run your team's own SimpleCMS One server: live collaboration, email sign-in, invitations, file storage —
on a machine you control. It is the same Docker image as the hosted cloud. The server is AGPL-3.0,
the app is MIT.

What you end up with:

```
https://cloud.yourcompany.com/app/    the app (your team signs in here)
https://cloud.yourcompany.com/        the landing page
```

One container runs the server (and serves the app), a second container (Caddy) gets and renews the
HTTPS certificate. All data lives in one Docker volume: a SQLite database plus uploaded files.

Time needed: about 30 minutes, most of it waiting for DNS.

---

## 1. What you need

- **A small Linux server** with a public IP. Any VPS works; for a team of up to a few dozen people the
  smallest plan of most hosters is enough (1–2 vCPU, 2–4 GB RAM, 20+ GB disk). On
  [Hetzner Cloud](https://www.hetzner.com/cloud) pick a location in Germany (Falkenstein or Nuremberg)
  if your data should stay there; both x86 and Arm (CAX) servers work. Ubuntu 24.04 LTS or Debian 12.
- **A domain** where you can add DNS records, e.g. `cloud.yourcompany.com`.
- **An SMTP account** for sign-in mails (see [step 5](#5-email-smtp)). You can start without one and
  read sign-in links from the server log, but your team will need real mail.
- On your computer: an SSH client.

## 2. Create the server

On Hetzner Cloud (other hosters are similar):

1. *Add Server* → location **Falkenstein** or **Nuremberg** → image **Ubuntu 24.04** → the smallest
   shared-vCPU type → add your **SSH key** (no password login).
2. *Firewalls* → create one that allows inbound **TCP 22, 80, 443** and **UDP 443** and attach it.
3. Note the server's IPv4 (and IPv6) address.

Log in and update:

```bash
ssh root@<server-ip>
apt update && apt -y upgrade
apt -y install unattended-upgrades git   # automatic security updates
```

## 3. DNS

At your DNS provider create:

| Type | Name | Value |
|---|---|---|
| `A` | `cloud` (→ `cloud.yourcompany.com`) | server IPv4 |
| `AAAA` | `cloud` | server IPv6 (optional) |

Check that it resolves before you continue (Caddy needs it to get a certificate):

```bash
dig +short cloud.yourcompany.com     # must print your server's IP
```

## 4. Install Docker and get the code

```bash
curl -fsSL https://get.docker.com | sh          # Docker Engine + compose plugin
git clone https://github.com/MarcelWeissgerberIT/SimpleCMS.git /opt/simplecms
cd /opt/simplecms/server
cp .env.example .env
chmod 600 .env
```

## 5. Configure

Edit `/opt/simplecms/server/.env` (`nano .env`):

```bash
DOMAIN=cloud.yourcompany.com
SECRET=<paste the output of: openssl rand -hex 32>
SMTP_URL=smtp://USERNAME:PASSWORD@smtp.provider.example:587
MAIL_FROM="Your Company Cloud <cloud@yourcompany.com>"
SIGNUP=invite
MAX_UPLOAD_MB=25
```

- **`SECRET`** protects every token. Keep it stable — changing it signs everyone out and invalidates
  open sign-in links and invitations. Back it up together with your data.
- **`SIGNUP`** decides who can create an account:
  - `invite` — only people with an invitation (recommended; you create the first admin in step 7),
  - `domains:yourcompany.com,yourcompany.de` — anyone with an address at those domains (subdomains
    don't count) plus invited people,
  - `open` — anyone with an email address.

### Email (SMTP)

The server only sends two kinds of mail: sign-in links and invitations. Any SMTP service works — use the
one your company already has, or a transactional mail provider (many have EU data centres and a free
tier that covers a team's sign-ins). Typical URLs:

```bash
SMTP_URL=smtp://USER:PASSWORD@smtp.example.com:587      # STARTTLS (most common)
SMTP_URL=smtps://USER:PASSWORD@smtp.example.com:465     # implicit TLS
```

- URL-encode special characters in user name and password: `@` → `%40`, `:` → `%3A`, `/` → `%2F`,
  `#` → `%23`.
- Some hosters block outgoing ports 25 and 465 on new servers (Hetzner Cloud does). Use port **587** or
  the alternative port your provider offers (often 2525), or ask the hoster to lift the block.
- For good deliverability set up **SPF, DKIM and DMARC** for the domain in `MAIL_FROM`, as your provider
  describes.
- No SMTP yet? Leave `SMTP_URL` empty: the server runs in *dev-mail mode* and writes every sign-in link
  to its log (`docker compose logs one | grep link=`). Fine for a first test — not for a team.

## 6. Start

```bash
cd /opt/simplecms/server
docker compose up -d --build        # first build takes a few minutes
docker compose ps                   # "one" should become healthy, "caddy" running
docker compose logs -f one          # look for: listening … mail=smtp, and "smtp ready"
curl https://cloud.yourcompany.com/api/health     # {"ok":true,"version":"…"}
```

Caddy requests the HTTPS certificate on the first request; if it fails, check that DNS points to the
server and ports 80/443 are open (`docker compose logs caddy`).

## 7. First sign-in

With `SIGNUP=invite`, create your own account first:

```bash
docker compose exec one node dist/cli.js create-user you@yourcompany.com "Your Name"
```

1. Open `https://cloud.yourcompany.com/app/` and sign in to the team cloud with that address.
2. Click the link in the mail (it is valid for 15 minutes and works once). Opened on another device or
   in another browser, the link shows a *Confirm sign-in* button first — that is intentional.
3. Create a workspace, then invite your team from its member settings — by email or with a link
   (links are shown once, valid for 7 days, single use).

Useful admin commands (`docker compose exec one node dist/cli.js help` lists all):

```bash
docker compose exec one node dist/cli.js list-workspaces
docker compose exec one node dist/cli.js list-users
docker compose exec one node dist/cli.js make-owner <workspaceId> someone@yourcompany.com
docker compose exec one node dist/cli.js revoke-sessions someone@yourcompany.com
```

## 8. Backups

Everything worth keeping:

| What | Where |
|---|---|
| Database (users, workspaces, all documents) | `/data/one.sqlite` in the `simplecms-one_one-data` volume |
| Uploaded files | `/data/files/` in the same volume |
| Configuration incl. `SECRET` | `/opt/simplecms/server/.env` |

Never copy `one.sqlite` with `cp` while the server runs — use one of the two options below.

### Option A — nightly snapshot + off-site copy (simple)

`backup` uses SQLite's `VACUUM INTO`: a consistent copy, safe while people are working.

`/opt/simplecms/backup.sh`:

```bash
#!/bin/sh
set -eu
cd /opt/simplecms/server
STAMP=$(date +%F)
DEST=/var/backups/simplecms
mkdir -p "$DEST"

docker compose exec -T one node dist/cli.js backup "/data/backups/one-$STAMP.sqlite"
docker compose cp "one:/data/backups/one-$STAMP.sqlite" "$DEST/"
docker compose exec -T one sh -c 'find /data/backups -name "one-*.sqlite" -mtime +3 -delete'

VOLUME=$(docker volume inspect -f '{{ .Mountpoint }}' simplecms-one_one-data)
rsync -a --delete "$VOLUME/files/" "$DEST/files/"
cp .env "$DEST/env.backup" && chmod 600 "$DEST/env.backup"
find "$DEST" -maxdepth 1 -name "one-*.sqlite" -mtime +14 -delete

# off-site, e.g. a Hetzner Storage Box, any rsync/SSH target or S3 via rclone/restic:
# rsync -a "$DEST/" u123456@u123456.your-storagebox.de:simplecms/
```

```bash
chmod +x /opt/simplecms/backup.sh
crontab -e     # add:  17 3 * * * /opt/simplecms/backup.sh >> /var/log/simplecms-backup.log 2>&1
```

### Option B — continuous replication with Litestream

[Litestream](https://litestream.io) streams every change of the database to S3-compatible storage
(e.g. Hetzner Object Storage), so you lose at most seconds. Add to `docker-compose.yml`:

```yaml
  litestream:
    image: litestream/litestream:0.3
    restart: unless-stopped
    command: replicate
    depends_on: [one]
    volumes:
      - one-data:/data
      - ./litestream.yml:/etc/litestream.yml:ro
    environment:
      LITESTREAM_ACCESS_KEY_ID: ${S3_ACCESS_KEY}
      LITESTREAM_SECRET_ACCESS_KEY: ${S3_SECRET_KEY}
```

and `server/litestream.yml`:

```yaml
dbs:
  - path: /data/one.sqlite
    replicas:
      - type: s3
        bucket: your-bucket
        path: simplecms
        endpoint: https://fsn1.your-objectstorage.com
        region: fsn1
```

Litestream covers the database only — keep syncing `/data/files` (rsync/rclone as in option A).

### Restore (test it once!)

```bash
cd /opt/simplecms/server
docker compose stop one
VOLUME=$(docker volume inspect -f '{{ .Mountpoint }}' simplecms-one_one-data)
rm -f "$VOLUME/one.sqlite-wal" "$VOLUME/one.sqlite-shm"
cp /var/backups/simplecms/one-YYYY-MM-DD.sqlite "$VOLUME/one.sqlite"   # or: litestream restore -o …
rsync -a /var/backups/simplecms/files/ "$VOLUME/files/"
chown -R 1000:1000 "$VOLUME"
docker compose start one
```

Restore with the **same `SECRET`**, or everyone has to sign in again (their data is unaffected).
Every device also keeps its own offline copy of the workspaces it opened, and syncs it back after
reconnecting.

## 9. Updates

```bash
cd /opt/simplecms
/opt/simplecms/backup.sh                 # always back up first
git pull
cd server && docker compose up -d --build
docker compose pull caddy && docker compose up -d caddy
docker image prune -f
```

Database migrations run automatically at start. A server never opens a database that a newer version
has already migrated (it refuses to start), so to roll back, restore the backup taken before the
update. Open browsers pick up the new app on their next load.

Rebuild about once a month even without a new release, to get security fixes of the Node base image.

## 10. Security checklist

- [ ] `SECRET` is random (`openssl rand -hex 32`), `.env` is `chmod 600` and not in any repository.
- [ ] `SIGNUP=invite` (or `domains:…`) unless you really want an open server.
- [ ] Firewall: only 22, 80, 443 (and UDP 443) inbound. SSH with keys only (`PasswordAuthentication no`).
- [ ] `unattended-upgrades` on; images rebuilt and Caddy pulled regularly.
- [ ] Backups run nightly, are stored off-site and a restore was tested.
- [ ] `DEV_MODE` is not set (the image runs with `NODE_ENV=production`, which refuses it anyway).
- [ ] Real SMTP configured — in dev-mail mode sign-in links are in the logs, so anybody who can read
      `docker compose logs` could sign in as anyone.
- [ ] SPF/DKIM/DMARC set for the `MAIL_FROM` domain.
- [ ] Server logs contain email addresses: keep access restricted and log retention short.
- [ ] Run one instance per database (rate limits and live sessions are held in memory).
- [ ] Changed the server code? The AGPL requires you to offer your users the modified source: publish
      it and set `SOURCE_URL` to it.
- [ ] Public instance in Germany/the EU: Impressum and privacy policy, data processing agreements
      (AVV) with your hoster and SMTP provider, and a record of processing activities.

## Appendix

### Your own reverse proxy instead of Caddy

Remove the `caddy` service, publish the server only on localhost and set the URL yourself:

```yaml
  one:
    ports: ["127.0.0.1:8080:8080"]
    environment:
      PUBLIC_URL: https://cloud.yourcompany.com
      TRUST_PROXY: "1"
```

nginx (WebSockets need the upgrade headers; uploads need a body size ≥ `MAX_UPLOAD_MB`):

```nginx
server {
  listen 443 ssl http2;
  server_name cloud.yourcompany.com;
  # ssl_certificate … ssl_certificate_key …
  client_max_body_size 30m;

  location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;   # map $http_upgrade $connection_upgrade { default upgrade; '' close; }
    proxy_read_timeout 1h;
  }
}
```

`TRUST_PROXY=1` makes the server take the client IP (for rate limits) from the right-most
`X-Forwarded-For` entry — only enable it when a proxy you control sets that header.

### Troubleshooting

| Symptom | Cause |
|---|---|
| Browser shows a certificate error | DNS not pointing to the server yet, or port 80/443 blocked — `docker compose logs caddy` |
| `configuration error: …` and the container restarts | A required variable is missing or malformed — the message says which |
| No sign-in mail | `docker compose logs one` shows `smtp connection failed` or `sending sign-in mail failed`; check port (587), credentials and URL-encoding. With `SIGNUP=invite` unknown addresses get no mail by design |
| `bad_origin` errors | The app is opened under another host than `DOMAIN` (e.g. `www.` or the IP) — use exactly `https://DOMAIN` |
| Live editing doesn't connect behind your own proxy | The proxy drops the WebSocket upgrade on `/collab` — see the nginx example |
| `database schema vN is newer than this server` | You went back to an older version — restore the backup from before the update |
