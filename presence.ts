import { execFile } from "node:child_process";
import { basename } from "node:path";

export type SessionPresence = {
  state: "open" | "unknown";
  pids: number[];
  checkedAt: string;
};

type PresenceCacheOptions = {
  readProcessTable?: () => Promise<string>;
  now?: () => number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CACHE_MS = 10_000;

function commandTokens(command: string): string[] {
  const tokens: string[] = [];
  let token = "";
  let quote = "";
  let escaped = false;
  let started = false;

  for (const character of command) {
    if (escaped) {
      token += character;
      escaped = false;
      started = true;
    } else if (character === "\\" && quote !== "'") {
      escaped = true;
      started = true;
    } else if (quote) {
      if (character === quote) quote = "";
      else token += character;
      started = true;
    } else if (character === "'" || character === '"') {
      quote = character;
      started = true;
    } else if (/\s/.test(character)) {
      if (started) {
        tokens.push(token);
        token = "";
        started = false;
      }
    } else {
      token += character;
      started = true;
    }
  }
  if (escaped) token += "\\";
  if (started) tokens.push(token);
  return tokens;
}

function sessionIds(args: string): string[] {
  const tokens = commandTokens(args);
  const ids: string[] = [];

  for (let index = 1; index < tokens.length; index++) {
    const token = tokens[index];
    if (token === "--") break;
    if (token.startsWith("--resume=")) {
      const id = token.slice("--resume=".length);
      if (UUID.test(id)) ids.push(id);
      continue;
    }
    if (token === "--session-id" || token === "--resume" || token === "-r") {
      const id = tokens[index + 1];
      if (id && UUID.test(id)) ids.push(id);
      index++;
    }
  }
  // A fork gets a different session ID; conflicting IDs are ambiguous.
  if (tokens.includes("--fork-session")) return [];
  const unique=[...new Set(ids.map(id=>id.toLowerCase()))];
  return unique.length===1?unique:[];
}

/** Parse `ps -ww -axo pid=,comm=,args=` output without executing any input. */
export function parseProcessTable(output: string, checkedAt = new Date().toISOString()): Map<string, SessionPresence> {
  const matches = new Map<string, Set<number>>();

  for (const line of output.split(/\r?\n/)) {
    const fields = /^\s*(\d+)\s+(\S+)\s+(.+)$/.exec(line);
    if (!fields) continue;
    const pid = Number(fields[1]);
    if (!Number.isSafeInteger(pid) || pid <= 0) continue;
    if (basename(fields[2].replace(/\\/g, "/")) !== "claude") continue;

    for (const id of sessionIds(fields[3])) {
      const pids = matches.get(id) ?? new Set<number>();
      pids.add(pid);
      matches.set(id, pids);
    }
  }

  return new Map([...matches].map(([id, pids]) => [id, {
    state: "open" as const,
    pids: [...pids].sort((left, right) => left - right),
    checkedAt,
  }]));
}

function readProcessTable(): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("ps", ["-ww", "-axo", "pid=,comm=,args="], {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      timeout: 2000,
    }, (error, stdout) => error ? reject(error) : resolve(stdout));
  });
}

function copyPresence(source: Map<string, SessionPresence>): Map<string, SessionPresence> {
  return new Map([...source].map(([id, presence]) => [id, { ...presence, pids: [...presence.pids] }]));
}

export class PresenceCache {
  private readonly poll: () => Promise<string>;
  private readonly now: () => number;
  private cached = new Map<string, SessionPresence>();
  private cachedAt = Number.NEGATIVE_INFINITY;
  private pending?: Promise<Map<string, SessionPresence>>;

  constructor(options: PresenceCacheOptions = {}) {
    this.poll = options.readProcessTable ?? readProcessTable;
    this.now = options.now ?? Date.now;
  }

  async read(): Promise<Map<string, SessionPresence>> {
    const now = this.now();
    if (now - this.cachedAt < CACHE_MS) return copyPresence(this.cached);
    if (this.pending) return copyPresence(await this.pending);

    this.pending = (async () => {
      let result = new Map<string, SessionPresence>();
      try {
        result = parseProcessTable(await this.poll(), new Date(this.now()).toISOString());
      } catch {
        // Presence is advisory. Process-table failures must not imply closure.
      }
      this.cached = result;
      this.cachedAt = this.now();
      return result;
    })();

    try {
      return copyPresence(await this.pending);
    } finally {
      this.pending = undefined;
    }
  }
}
