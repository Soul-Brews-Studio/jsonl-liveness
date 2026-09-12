import { latestMessages } from "./session-status";
import { ActivityCache, type MessageSummary } from "./activity";
import { PresenceCache, type SessionPresence } from "./presence";
import { readSessionDetail, type SessionDetail } from "./details";
import { scan, defaults, type Thresholds, type TailCache } from "./liveness";
import { loadNames, saveName, sessionId, namesPath } from "./names";
import { normalizeHost } from "./host";
import { TimelineCache, type TimelineSnapshot } from "./timeline";

export type Snapshot = Omit<Awaited<ReturnType<typeof scan>>, "files"> & {
  messageReads?: number;
  files: Array<Awaited<ReturnType<typeof scan>>["files"][number] & { id?: string; name?: string | null; message?:MessageSummary; presence?:SessionPresence }>;
};
export interface SessionSource {
  read(): Promise<Snapshot>;
  timeline(project?: string | string[], limit?: number): Promise<TimelineSnapshot>;
  rename(path: string, name: string): Promise<void>;
  detail(path: string): Promise<SessionDetail>;
}
export function localSource(root: string, thresholds: Thresholds = defaults, store = namesPath): SessionSource {
  const cache:TailCache=new Map();
  const activity=new ActivityCache(root),presence=new PresenceCache();
  const timelineCache=new TimelineCache(root);
  let current:Snapshot|undefined;
  async function read():Promise<Snapshot> {
    const started=performance.now();
    const [snapshot, names, processes] = await Promise.all([scan(root, thresholds,Date.now(),cache), loadNames(store),presence.read()]);
    activity.prune(new Set(snapshot.files.map(file=>file.path)));
    const before=activity.reads;
    const files:Snapshot["files"]=[];
    let cursor=0;
    // Bound concurrent reads during a cold scan; subsequent ticks are cached.
    await Promise.all(Array.from({length:8},async()=>{
      while(cursor<snapshot.files.length){
        const file=snapshot.files[cursor++],id=sessionId(file.path);
        const message=await activity.read(file.path,file.revision??`${file.mtimeMs}:${file.size}`);
        files.push({...file,id,name:names[file.path]??null,message,
          presence:processes.get(id.toLowerCase())??{state:"unknown",pids:[],checkedAt:snapshot.scannedAt}});
      }
    }));
    current={...snapshot, scanMs:Math.round(performance.now()-started),files:latestMessages(files),messageReads:activity.reads-before};
    return current;
  }
  return {
    read,
    async timeline(project,limit=200) { return timelineCache.read(current??await read(),project,limit); },
    async detail(path) { return readSessionDetail(root,path); },
    async rename(path, name) { await saveName(path, name, store); },
  };
}
export function snapshotNames(snapshot: Snapshot): Record<string, string> {
  return Object.fromEntries(snapshot.files.filter(file => file.name).map(file => [file.path, file.name!]));
}
export function isTimelineSnapshot(value:unknown):value is TimelineSnapshot {
  if(!value||typeof value!=="object")return false;
  const data=value as TimelineSnapshot;
  return typeof data.scannedAt==="string" && Number.isFinite(Date.parse(data.scannedAt)) &&
    [data.filesConsidered,data.totalFiles,data.tailBytes,data.maxSessions,data.limit,data.omittedRows,data.readErrors,data.reads].every(n=>Number.isFinite(n)&&n>=0) &&
    typeof data.limitedSessions==="boolean" && Array.isArray(data.rows) && data.rows.every(row=>
      row&&[row.id,row.path,row.sessionId,row.project,row.tier,row.role,row.title,row.text].every(v=>typeof v==="string") &&
      ["message","tool-use","tool-result","event"].includes(row.kind) && typeof row.truncated==="boolean" &&
      (row.name===null||typeof row.name==="string") &&
      (row.timestamp===null||(typeof row.timestamp==="string"&&Number.isFinite(Date.parse(row.timestamp)))));
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
    async timeline(project,limit=200) {
      const params=new URLSearchParams({limit:String(limit)});
      for(const value of project===undefined?[]:Array.isArray(project)?project:[project])params.append("project",value);
      const value=await request(`/api/timeline?${params}`);
      if(!isTimelineSnapshot(value))throw new Error("Backend returned an invalid timeline");
      return value;
    },
    async detail(path) {
      const value=await request(`/api/session/detail?path=${encodeURIComponent(path)}`);
      if(!value||value.path!==path||!Array.isArray(value.events))throw new Error("Backend returned invalid session details");
      return value as SessionDetail;
    },
    async rename(path, name) { await request("/api/names", {method: "PUT", headers: {"Content-Type":"application/json"}, body: JSON.stringify({path, name})}); },
  };
}
