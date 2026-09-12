import { readSessionDetail, type SessionDetail } from "./details";
import { scan, defaults, type Thresholds, type TailCache } from "./liveness";
import { loadNames, saveName, sessionId, namesPath } from "./names";
import { normalizeHost } from "./host";

export type Snapshot = Omit<Awaited<ReturnType<typeof scan>>, "files"> & {
  files: Array<Awaited<ReturnType<typeof scan>>["files"][number] & { id?: string; name?: string | null }>;
};
export interface SessionSource {
  read(): Promise<Snapshot>;
  rename(path: string, name: string): Promise<void>;
  detail(path: string): Promise<SessionDetail>;
}
export function localSource(root: string, thresholds: Thresholds = defaults, store = namesPath): SessionSource {
  const cache:TailCache=new Map();
  return {
    async read() {
      const [snapshot, names] = await Promise.all([scan(root, thresholds,Date.now(),cache), loadNames(store)]);
      return {...snapshot, files: snapshot.files.map(file => ({...file, id: sessionId(file.path), name: names[file.path] ?? null}))};
    },
    async detail(path) { return readSessionDetail(root,path); },
    async rename(path, name) { await saveName(path, name, store); },
  };
}
export function snapshotNames(snapshot: Snapshot): Record<string, string> {
  return Object.fromEntries(snapshot.files.filter(file => file.name).map(file => [file.path, file.name!]));
}
export function remoteSource(host: string, token?: string): SessionSource {
  const origin = normalizeHost(host);
  async function request(path: string, init: RequestInit = {}) {
    const response = await fetch(`${origin}${path}`, {
      ...init, redirect: "error", signal: AbortSignal.timeout(10_000),
      headers: {...(init.headers as Record<string, string>), ...(token ? {Authorization: `Bearer ${token}`} : {})},
    });
    if (!response.ok) throw new Error(`Backend ${response.status}: ${(await response.text()).slice(0, 180)}`);
    return response.json();
  }
  return {
    async read() {
      const value = await request("/api/snapshot");
      if (!value || !Array.isArray(value.files) || !value.counts || typeof value.scannedAt !== "string") {
        throw new Error("Backend returned an invalid snapshot");
      }
      return value as Snapshot;
    },
    async detail(path) {
      const value=await request(`/api/session/detail?path=${encodeURIComponent(path)}`);
      if(!value||value.path!==path||!Array.isArray(value.events))throw new Error("Backend returned invalid session details");
      return value as SessionDetail;
    },
    async rename(path, name) { await request("/api/names", {method: "PUT", headers: {"Content-Type":"application/json"}, body: JSON.stringify({path, name})}); },
  };
}
