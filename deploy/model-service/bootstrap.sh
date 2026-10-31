#!/usr/bin/env bash
# Run as root after uploading the reviewed service bundle. Contains no secrets.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
cd /opt/atlas-flow
nvidia-smi --query-gpu=name,memory.total --format=csv,noheader
apt-get -o DPkg::Lock::Timeout=120 update -qq
apt-get -o DPkg::Lock::Timeout=120 install -y --no-install-recommends curl ca-certificates zstd xz-utils

NODE_VERSION=v24.22.2
curl -fsSLo node.tar.xz "https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-linux-x64.tar.xz"
curl -fsSLo SHASUMS256.txt "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt"
mv node.tar.xz "node-$NODE_VERSION-linux-x64.tar.xz"
awk -v name="node-$NODE_VERSION-linux-x64.tar.xz" '$2==name' SHASUMS256.txt | sha256sum --check --status
test -s "node-$NODE_VERSION-linux-x64.tar.xz"
tar -xJf "node-$NODE_VERSION-linux-x64.tar.xz" -C /usr/local --strip-components=1
rm "node-$NODE_VERSION-linux-x64.tar.xz" SHASUMS256.txt

OLLAMA_VERSION=0.40.8 sh ./ollama-install.sh
mkdir -p /etc/systemd/system/ollama.service.d
cat > /etc/systemd/system/ollama.service.d/atlas-flow.conf <<'EOF'
[Service]
Environment="OLLAMA_HOST=127.0.0.1:11434"
Environment="OLLAMA_NUM_PARALLEL=1"
Environment="OLLAMA_MAX_LOADED_MODELS=1"
Environment="OLLAMA_MAX_QUEUE=12"
Environment="OLLAMA_CONTEXT_LENGTH=32768"
Environment="OLLAMA_FLASH_ATTENTION=1"
Environment="OLLAMA_KV_CACHE_TYPE=q8_0"
Environment="OLLAMA_KEEP_ALIVE=30m"
Environment="OLLAMA_NO_CLOUD=1"
EOF
systemctl daemon-reload
systemctl restart ollama
for i in $(seq 1 30); do curl -fsS http://127.0.0.1:11434/api/version >/dev/null && break; sleep 1; done
curl --fail-with-body -sS http://127.0.0.1:11434/api/pull -H 'Content-Type: application/json' --data '{"model":"qwen3-coder:30b","stream":false}'
curl --fail-with-body -sS http://127.0.0.1:11434/api/create -H 'Content-Type: application/json' --data-binary @create-service-model.json

id atlas-flow >/dev/null 2>&1 || useradd --system --create-home --home-dir /var/lib/atlas-flow --shell /usr/sbin/nologin atlas-flow
install -d -m 0750 -o root -g atlas-flow /etc/atlas-flow
install -m 0640 -o root -g atlas-flow api-keys.json /etc/atlas-flow/api-keys.json
cat >/etc/systemd/system/atlas-flow-gateway.service <<'EOF'
[Unit]
Description=Atlas Flow authenticated inference gateway
After=network-online.target ollama.service
Requires=ollama.service
[Service]
User=atlas-flow
Group=atlas-flow
ExecStart=/usr/local/bin/node /opt/atlas-flow/gateway.mjs
Environment=ATLAS_FLOW_KEYS=/etc/atlas-flow/api-keys.json
Restart=on-failure
RestartSec=5
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes
UMask=0077
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
[Install]
WantedBy=multi-user.target
EOF
for project in cnsx felix; do
  install -d -m 0700 -o atlas-flow -g atlas-flow "/var/lib/atlas-flow/$project"
  printf '{"repos":[],"intake":false}\n' >"/var/lib/atlas-flow/$project/worker.json"
  printf '{"model":"atlas-flow:latest","label":"Atlas Flow · Frankfurt (GCP)","enabled":true}\n' >"/var/lib/atlas-flow/$project/worker.json.model-share.json"
  chown -R atlas-flow:atlas-flow "/var/lib/atlas-flow/$project"
  chmod 0600 "/var/lib/atlas-flow/$project/"*.json
  chown root:atlas-flow "/opt/atlas-flow/$project/one-worker.mjs"
  chmod 0640 "/opt/atlas-flow/$project/one-worker.mjs"
  install -m 0640 -o root -g atlas-flow "/opt/atlas-flow/$project/preset.json" "/etc/atlas-flow/$project-preset.json"
  cat >"/etc/systemd/system/atlas-flow-$project.service" <<EOF
[Unit]
Description=Atlas Flow ONE model host ($project)
After=network-online.target atlas-flow-gateway.service
Requires=atlas-flow-gateway.service
[Service]
User=atlas-flow
Group=atlas-flow
WorkingDirectory=/var/lib/atlas-flow/$project
ExecStart=/usr/local/bin/node /opt/atlas-flow/one-host.mjs
Environment=HOME=/var/lib/atlas-flow/$project
Environment=ONE_WORKER_CONFIG=/var/lib/atlas-flow/$project/worker.json
Environment=MODEL_HOST_PRESET_FILE=/etc/atlas-flow/$project-preset.json
Environment=ONE_CODER_OLLAMA=http://127.0.0.1:8081
Environment=ONE_WORKER_QUIET=1
Restart=on-failure
RestartPreventExitStatus=2
RestartSec=5
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ReadWritePaths=/var/lib/atlas-flow/$project
ProtectHome=yes
UMask=0077
[Install]
WantedBy=multi-user.target
EOF
done
chmod 0755 /opt/atlas-flow
chmod 0755 /opt/atlas-flow/cnsx /opt/atlas-flow/felix
chmod 0644 /opt/atlas-flow/gateway.mjs /opt/atlas-flow/keys.mjs
chmod 0644 /opt/atlas-flow/one-host.mjs
systemctl daemon-reload
systemctl enable --now atlas-flow-gateway atlas-flow-cnsx atlas-flow-felix
printf '\nATLAS_FLOW_BOOTSTRAP_COMPLETE\n'
