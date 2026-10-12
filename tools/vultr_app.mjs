// Deploys this app (the built dist/ and server/) to the owner's Vultr machine in Johannesburg, which serves every
// BruNet site under brunet.tv (it replaced Fly.io in 2026-10).
//   node tools/vultr_app.mjs            build, ship, restart, check /api/health
//   node tools/vultr_app.mjs --status   is it running, memory, the last log lines
//   node tools/vultr_app.mjs --logs     the last 100 log lines
// BRUNET_VPS overrides the machine's address. One tar over one ssh connection (keys only, as root).
// On the machine: the systemd service <name> as the user <name> on 127.0.0.1:<port>, its data in /srv/<name>/data,
// its secrets in /srv/<name>/app.env (never sent from here), and Caddy's site file /etc/caddy/sites/<name>.caddy.
// The same file lives in C:\Legacy and C:\mindgrove; only APP below differs.

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const APP = { name: "mindgrove", port: 8431, env: "NODE_ENV=production DIST_DIR=/srv/mindgrove/app/dist DATA_DIR=/srv/mindgrove/data" };

const HOST = process.env.BRUNET_VPS ?? "139.84.244.36";
const ROOT = resolve(import.meta.dirname, "..");
const SSH = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=15", `root@${HOST}`];
const { name, port } = APP, DIR = `/srv/${name}`, DOMAIN = `${name}.brunet.tv`;

const UNIT = `[Unit]
Description=${name}
After=network-online.target
Wants=network-online.target

[Service]
User=${name}
Group=${name}
WorkingDirectory=${DIR}/app
Environment=PORT=${port} HOST=127.0.0.1 ${APP.env}
EnvironmentFile=-${DIR}/app.env
ExecStart=/usr/bin/node server/server.mjs
Restart=always
RestartSec=2
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=${DIR}/data
MemoryMax=300M

[Install]
WantedBy=multi-user.target
`;

const CADDY = `${DOMAIN} {
	encode zstd gzip
	reverse_proxy 127.0.0.1:${port}
}
`;

const REMOTE = `set -e
chown -R ${name}:${name} ${DIR}/data
[ -f ${DIR}/app.env ] || { touch ${DIR}/app.env; }
chown root:${name} ${DIR}/app.env; chmod 640 ${DIR}/app.env
rm -rf ${DIR}/prev
[ -d ${DIR}/app ] && mv ${DIR}/app ${DIR}/prev
mv ${DIR}/next ${DIR}/app
chmod -R a+rX ${DIR}/app
cat > /etc/systemd/system/${name}.service <<'UNIT'
${UNIT}UNIT
systemctl daemon-reload
systemctl enable ${name} >/dev/null 2>&1
systemctl restart ${name}
mkdir -p /etc/caddy/sites
cat > /tmp/${name}.caddy <<'CADDY'
${CADDY}CADDY
if ! cmp -s /tmp/${name}.caddy /etc/caddy/sites/${name}.caddy; then mv /tmp/${name}.caddy /etc/caddy/sites/${name}.caddy; systemctl reload caddy; fi
sleep 2
systemctl is-active ${name}
curl -s -w " [%{http_code}]" http://127.0.0.1:${port}/api/health; echo
`;

function ssh(cmd) {
  const r = spawnSync("ssh", [...SSH, cmd], { encoding: "utf8" });
  process.stdout.write(r.stdout + r.stderr);
  return r.status ?? 1;
}

const arg = process.argv[2];
if (arg === "--status") process.exit(ssh(`systemctl is-active ${name}; systemctl show ${name} -p MemoryCurrent -p ActiveEnterTimestamp; journalctl -u ${name} -n 5 --no-pager`));
if (arg === "--logs") process.exit(ssh(`journalctl -u ${name} -n 100 --no-pager`));

console.log(`deploying ${name} to ${HOST} (https://${DOMAIN})`);
if (!process.argv.includes("--no-build")) {
  const build = spawnSync("npm run build", { cwd: ROOT, encoding: "utf8", shell: true });
  if (build.status !== 0) { process.stdout.write(build.stdout + build.stderr); console.error("build failed"); process.exit(1); }
}
if (!existsSync(resolve(ROOT, "dist", "index.html"))) { console.error("no dist/index.html"); process.exit(1); }
const tar = spawn("tar", ["-czf", "-", "dist", "server", "package.json"], { cwd: ROOT, stdio: ["ignore", "pipe", "inherit"] });
const up = spawn("ssh", [...SSH, `rm -rf ${DIR}/next && mkdir -p ${DIR}/next ${DIR}/data && tar -xzf - -C ${DIR}/next`], { stdio: ["pipe", "inherit", "inherit"] });
tar.stdout.pipe(up.stdin);
up.on("close", (code) => {
  if (code !== 0) { console.error(`upload failed (${code})`); process.exit(code ?? 1); }
  const run = spawnSync("ssh", [...SSH, "bash -s"], { input: REMOTE, encoding: "utf8" });
  process.stdout.write(run.stdout + run.stderr);
  if (run.status !== 0) { console.error(`install failed (${run.status})`); process.exit(run.status ?? 1); }
  const r = spawnSync("curl", ["-s", "-w", " [%{http_code} %{time_total}s]", `https://${DOMAIN}/api/health`], { encoding: "utf8" });
  console.log(`public: ${r.stdout.trim() || "(no answer yet: the certificate can take a minute on the first deploy)"}`);
});
