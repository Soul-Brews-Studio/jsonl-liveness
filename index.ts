import { homedir } from "node:os";
import { resolve, join } from "node:path";
import { defaults } from "./liveness";
import { render } from "./display";
import { findSession, sessionId } from "./names";
import { localSource, remoteSource, snapshotNames } from "./source";
import { startServer } from "./server";
import { watchTui } from "./tui";

function duration(value: string): number {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/.exec(value);
  if (!match) throw new Error(`Invalid duration: ${value}`);
  const units = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 };
  return Number(match[1]) * units[(match[2] || "s") as keyof typeof units];
}
async function main() {
  let root = join(homedir(), ".claude/projects"), once = false, json = false;
  let host: string | undefined, serve = false, listen = "127.0.0.1", port = 47881;
  const allowedOrigins: string[] = [];
  let localOptions = false;
  const thresholds = {...defaults};
  let naming: {id: string; value: string} | undefined;
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help") {
      console.log(`JSONL liveness
  bun run .                         local live TUI
  bun run . --once --json            local snapshot
  bun run . --serve [--port 47881]    backend + browser UI
  bun run . --host localhost:47881   remote TUI (or --once --json)
  bun run . --name ID "Name"         local alias; combine with --host for remote
  --root DIR --hot 2m --warm 15m --cool 2h (local scanner only)
  --listen ADDRESS --allow-origin ORIGIN (server only)
  JSONL_TOKEN environment variable protects server / authenticates clients`);
      return;
    } else if (arg === "--serve") serve = true;
    else if (["--host", "--port", "--listen", "--allow-origin"].includes(arg)) {
      const value = args[++i];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
      if (arg === "--host") host = value;
      else if (arg === "--port") { port = Number(value); if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Port must be 0–65535"); }
      else if (arg === "--listen") listen = value;
      else allowedOrigins.push(value);
    } else if (arg === "--name") {
      const id = args[++i], value = args[++i];
      if (!id || value === undefined) throw new Error("Usage: --name SESSION_ID \"Display name\"");
      naming = {id, value};
    } else if (arg === "--once") once = true;
    else if (arg === "--watch") once = false;
    else if (arg === "--json") json = true;
    else if (["--root", "--hot", "--warm", "--cool"].includes(arg)) {
      const value = args[++i];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
      localOptions = true;
      if (arg === "--root") root = resolve(value);
      else thresholds[arg.slice(2) as keyof typeof thresholds] = duration(value);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!(0 < thresholds.hot && thresholds.hot < thresholds.warm && thresholds.warm < thresholds.cool)) {
    throw new Error("Thresholds must satisfy 0 < hot < warm < cool");
  }
  if (serve && (host || once || json || naming)) throw new Error("--serve cannot be combined with --host, --once, --json or --name");
  if (host && localOptions) throw new Error("--host uses the backend root/thresholds; do not combine with local scanner options");
  if (serve) {
    const running = await startServer({root, thresholds, port, listen, token: process.env.JSONL_TOKEN, allowedOrigins});
    console.log(`JSONL backend + web UI: ${running.url}
TUI: bun run . --host ${running.url}
${process.env.JSONL_TOKEN ? "Bearer token required for API requests" : "Loopback only; no API token configured"}`);
    process.once("SIGINT", () => { running.stop(); });
    process.once("SIGTERM", () => { running.stop(); });
    return;
  }
  const source = host ? remoteSource(host, process.env.JSONL_TOKEN) : localSource(root, thresholds);
  if (naming) {
    const snapshot = await source.read();
    const file = findSession(snapshot.files, naming.id);
    await source.rename(file.path, naming.value);
    console.log(`${sessionId(file.path)}: ${naming.value.trim() || "(name cleared)"}`);
    return;
  }
  if (!once && !json && process.stdin.isTTY && process.stdout.isTTY) {
    await watchTui(root, thresholds, source);
    return;
  }
  do {
    const started = performance.now();
    const result = await source.read();
    const names = snapshotNames(result);
    if (json) console.log(JSON.stringify(result));
    else {
      if (!once) process.stdout.write("\x1b[2J\x1b[H");
      console.log(render(result, once ? Infinity : Math.max(1, (process.stdout.rows || 30) - 8), names));
      for (const error of result.errors) console.error(error);
    }
    if (once) { if (result.errors.length) process.exitCode = 1; break; }
    await Bun.sleep(Math.max(0, 1000 - (performance.now() - started)));
  } while (true);
}
main().catch(error => { console.error(String(error)); process.exitCode = 1; });
