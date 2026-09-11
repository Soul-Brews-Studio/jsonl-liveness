import { open, readdir, stat } from "node:fs/promises";
import type { Stats } from "node:fs";
import { join, relative, sep } from "node:path";

export const defaults = { hot: 120_000, warm: 900_000, cool: 7_200_000 };
export type Thresholds = typeof defaults;
export type TailCache = Map<string, {revision:string;type:string|null;role:string|null}>;
export type Class = "hot" | "warm" | "cool" | "dead";
export function statRevision(info: Pick<Stats, "mtimeMs" | "ctimeMs" | "size" | "ino">): string {
  return `${info.mtimeMs}:${info.ctimeMs}:${info.size}:${info.ino}`;
}
export function classify(age: number, thresholds = defaults): Class {
  return age < thresholds.hot ? "hot" : age < thresholds.warm ? "warm" : age < thresholds.cool ? "cool" : "dead";
}
export function tier(path: string): string {
  const parts = path.replaceAll("\\", "/").split("/");
  if (/^wf_/.test(parts.at(-2) ?? "") && parts.includes("workflows")) {
    return parts.at(-1) === "journal.jsonl" ? "workflow-journal" : "workflow-agent";
  }
  return parts.includes("subagents") ? "subagent" : "session";
}
export function projectName(path: string): string {
  return path.split(sep)[0].replaceAll("-", "/");
}

// Walk backwards to the final newline, then the preceding newline. An unfinished
// suffix is never parsed, even when it happens to be syntactically valid JSON.
export async function lastCompleteLine(path: string): Promise<string | undefined> {
  const file = await open(path, "r");
  try {
    let position = (await file.stat()).size;
    let foundEnd = false;
    const chunks: Buffer[] = [];
    while (position > 0) {
      const length = Math.min(4096, position);
      position -= length;
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await file.read(buffer, 0, length, position);
      let end = bytesRead;
      if (!foundEnd) {
        const newline = buffer.subarray(0, end).lastIndexOf(10);
        if (newline < 0) continue;
        foundEnd = true;
        end = newline;
      }
      const start = buffer.subarray(0, end).lastIndexOf(10);
      chunks.unshift(buffer.subarray(start + 1, end));
      if (start >= 0) break;
    }
    return foundEnd ? Buffer.concat(chunks).toString("utf8").replace(/\r$/, "") : undefined;
  } finally { await file.close(); }
}

export async function scan(root: string, thresholds = defaults, now = Date.now(), cache: TailCache = new Map()) {
  const files: Array<{path: string; project: string; session: string; tier: string; class: Class; age: number; size: number; revision?: string; mtimeMs?:number;modifiedAt?:string;type: string | null; role: string | null}> = [];
  const errors: string[] = [];
  let tailReads=0;const seen=new Set<string>();
  async function walk(directory: string) {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch (error) { errors.push(`${directory}: ${error}`); return; }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) { await walk(path); continue; }
      if (!entry.name.endsWith(".jsonl")) continue;
      try {
        const info = await stat(path);
        if (!info.isFile()) continue;
        const age = Math.max(0, now - info.mtimeMs);
        seen.add(path);
        const revision=statRevision(info);
        const cached=cache.get(path);
        let type: string | null = null, role: string | null = null;
        if(cached?.revision===revision){type=cached.type;role=cached.role;}
        else try {
          tailReads++;
          const line = await lastCompleteLine(path);
          const value = line ? JSON.parse(line) : null;
          type = typeof value?.type === "string" ? value.type : null;
          const lastRole = value?.role ?? value?.message?.role;
          role = typeof lastRole === "string" ? lastRole : null;
          cache.set(path,{revision,type,role});
        } catch (error) {
          if (error instanceof SyntaxError) cache.set(path,{revision,type:null,role:null});
          else {cache.delete(path);errors.push(`${path}: ${error}`);}
        }
        const local = relative(root, path);
        files.push({path, project: projectName(local), session: entry.name.slice(0, -6).slice(0, 8), tier: tier(local), class: classify(age, thresholds), age, size: info.size,revision,mtimeMs:info.mtimeMs,modifiedAt:info.mtime.toISOString(), type, role});
      } catch (error) { errors.push(`${path}: ${error}`); }
    }
  }
  const started = performance.now();
  await walk(root);
  for(const path of cache.keys())if(!seen.has(path))cache.delete(path);
  files.sort((a, b) => a.age - b.age || a.path.localeCompare(b.path));
  const counts = {hot: 0, warm: 0, cool: 0, dead: 0};
  for (const file of files) counts[file.class]++;
  return {root, scannedAt: new Date(now).toISOString(), scanMs: Math.round(performance.now() - started), counts, files, errors,tailReads};
}
