// Cross-platform tsx API-server manager: `node scripts/server.mjs <up|down|status>`.
//
// Runs identically from any shell (git bash, WSL, PowerShell, cmd) because it's
// just Node. It branches on the OS it actually runs under for process-tree
// handling — taskkill /T on Windows, process-group kill on POSIX — so the
// orphaned-process safeguards work without shell-specific commands in the Taskfile.
import { spawn, execSync } from "node:child_process";
import { connect } from "node:net";
import { fileURLToPath } from "node:url";
import { dirname, join, basename } from "node:path";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  rmSync,
  openSync,
} from "node:fs";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = Number(process.env.PORT ?? 3999);
const PIDFILE = join(repoRoot, process.env.PIDFILE ?? ".server.pid");
const SERVER_DIR = join(repoRoot, process.env.SERVER_DIR ?? "apps/server");
const ENTRY = process.env.ENTRY ?? "src/index.ts";
const LOGFILE = join(repoRoot, ".server.log");
const TSX = join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs");
const isWin = process.platform === "win32";
const repoName = basename(repoRoot);

/**
 * True if a server is answering on the port. Uses a CONNECT probe (not a bind)
 * and tries both IPv4 and IPv6 loopback, so it doesn't miss a server that bound
 * only one stack (e.g. @hono/node-server on IPv6).
 */
const isUp = (port) =>
  new Promise((resolve) => {
    const tryHost = (host, next) => {
      const sock = connect({ port, host });
      sock.setTimeout(500);
      const done = (result) => {
        sock.destroy();
        result ? resolve(true) : next();
      };
      sock.once("connect", () => done(true));
      sock.once("timeout", () => done(false));
      sock.once("error", () => done(false));
    };
    tryHost("127.0.0.1", () => tryHost("::1", () => resolve(false)));
  });

/** Kill a process and its whole child tree, per-OS. */
function killTree(pid) {
  if (!pid) return;
  try {
    if (isWin) {
      execSync(`taskkill /F /T /PID ${pid}`, { stdio: "ignore" });
    } else {
      try {
        process.kill(-pid, "SIGTERM"); // negative pid = the process group
      } catch {
        process.kill(pid, "SIGTERM");
      }
    }
  } catch {
    /* already gone */
  }
}

/** Safeguard: reap untracked tsx orphans belonging to THIS repo (stale pidfile, etc.). */
function sweepOrphans() {
  try {
    if (isWin) {
      const q =
        `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | ` +
        `Where-Object { $_.CommandLine -match 'tsx' -and $_.CommandLine -match 'index\\.ts' -and $_.CommandLine -match '${repoName}' } | ` +
        `ForEach-Object { taskkill /F /T /PID $_.ProcessId }`;
      execSync(`powershell -NoProfile -Command "${q}"`, { stdio: "ignore" });
    } else {
      const out = execSync("ps -e -o pid=,args=", { encoding: "utf8" });
      for (const line of out.split("\n")) {
        if (
          /tsx/.test(line) &&
          /index\.ts/.test(line) &&
          line.includes(repoName) &&
          !line.includes("server.mjs")
        ) {
          killTree(Number(line.trim().split(/\s+/)[0]));
        }
      }
    }
  } catch {
    /* best effort */
  }
}

const readPid = () =>
  existsSync(PIDFILE) ? Number(readFileSync(PIDFILE, "utf8").trim()) || 0 : 0;

function down() {
  killTree(readPid());
  if (existsSync(PIDFILE)) rmSync(PIDFILE);
  sweepOrphans();
  console.log(`server:down - stopped (port ${PORT}), orphans swept (${repoName})`);
}

async function up() {
  if (await isUp(PORT)) {
    console.error(
      `server:up - port ${PORT} in use; run 'task server:down' first`,
    );
    process.exit(1);
  }
  const log = openSync(LOGFILE, "a");
  const child = spawn(process.execPath, [TSX, ENTRY], {
    cwd: SERVER_DIR,
    env: { ...process.env, PORT: String(PORT) },
    detached: true, // own process group so killTree can reap the whole tree
    windowsHide: true,
    stdio: ["ignore", log, log],
  });
  writeFileSync(PIDFILE, String(child.pid));
  child.unref();
  console.log(
    `server:up - pid ${child.pid} on http://localhost:${PORT} (logs: .server.log)`,
  );
}

async function status() {
  const busy = await isUp(PORT);
  console.log(
    busy
      ? `server:status - UP (port ${PORT} responding)`
      : `server:status - DOWN (port ${PORT} free)`,
  );
}

const actions = { up, down, status };
const cmd = process.argv[2];
if (!actions[cmd]) {
  console.error("usage: node scripts/server.mjs <up|down|status>");
  process.exit(2);
}
await actions[cmd]();
