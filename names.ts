import { readFile, mkdir, writeFile, rename, unlink } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

export type Names = Record<string, string>;
export const namesPath = resolve(import.meta.dir, ".local", "names.json");
export const sessionId = (path: string) => basename(path, ".jsonl");
export function validateName(value: string): string {
  const name = value.trim();
  if (Array.from(name).length > 80 || /[\x00-\x1f\x7f-\x9f]/.test(name)) {
    throw new Error("Names must be at most 80 characters, without control characters");
  }
  return name;
}
export async function loadNames(path = namesPath): Promise<Names> {
  let source: string;
  try { source = await readFile(path, "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return {}; throw error; }
  const value: unknown = JSON.parse(source);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid name store: ${path}`);
  for (const name of Object.values(value)) {
    if (typeof name !== "string") throw new Error(`Invalid name store: ${path}`);
    validateName(name);
  }
  return value as Names;
}
export async function saveName(filePath: string, value: string, storePath = namesPath): Promise<Names> {
  const name = validateName(value);
  const names = await loadNames(storePath);
  if (name) names[resolve(filePath)] = name;
  else delete names[resolve(filePath)];
  await mkdir(dirname(storePath), { recursive: true });
  const temporary = `${storePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(names, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    await rename(temporary, storePath);
  } finally { await unlink(temporary).catch(() => {}); }
  return names;
}
export function findSession<T extends { path: string }>(files: T[], identifier: string): T {
  if (identifier.startsWith("a:")) identifier = `agent-${identifier.slice(2)}`;
  const exact = files.filter(file => file.path === identifier || sessionId(file.path) === identifier);
  const matches = exact.length ? exact : files.filter(file => sessionId(file.path).startsWith(identifier));
  if (matches.length !== 1) throw new Error(matches.length ? `Ambiguous session ID '${identifier}'; use the full file path` : `No session matches '${identifier}'`);
  return matches[0];
}
