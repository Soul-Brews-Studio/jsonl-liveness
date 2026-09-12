import { localSource, type SessionSource, type Snapshot } from "./source";
import { defaults, type Thresholds } from "./liveness";
import { readSessionDetail, DETAIL_BYTES } from "./details";
import { FingerprintCache } from "./fingerprint";
import { namesPath, validateName } from "./names";
import { TimelineCache } from "./timeline";

/** One scanner per backend; all HTTP clients share its snapshot. */
export class LivenessService {
  private source: SessionSource;
  private current?: Snapshot;
  private pending?: Promise<Snapshot>;
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = true;
  private listeners = new Set<(snapshot: Snapshot) => void>();
  private writes: Promise<void> = Promise.resolve();
  private fingerprints=new FingerprintCache();
  private timelineCache: TimelineCache;
  error: string | undefined;
  constructor(private root: string, thresholds: Thresholds = defaults, store = namesPath) {
    this.source = localSource(root, thresholds, store);
    this.timelineCache = new TimelineCache(root);
  }
  async refresh(): Promise<Snapshot> {
    if (this.pending) return this.pending;
    this.pending = this.source.read().then(snapshot => {
      this.current = snapshot;
      this.error = undefined;
      for (const listener of this.listeners) {
        try { listener(snapshot); } catch { this.listeners.delete(listener); }
      }
      return snapshot;
    }).catch(error => { this.error = String(error); throw error; }).finally(() => { this.pending = undefined; });
    return this.pending;
  }
  async snapshot(): Promise<Snapshot> { return this.current ?? this.refresh(); }
  async start() {
    if (!this.stopped) return;
    this.stopped = false;
    try { await this.refresh(); } catch (error) { this.stopped = true; throw error; }
    const tick = async () => {
      const start = performance.now();
      try { await this.refresh(); } catch { /* health reports errors; retry next cycle */ }
      if (!this.stopped) this.timer = setTimeout(tick, Math.max(100, 2000 - (performance.now() - start)));
    };
    this.timer = setTimeout(tick, 2000);
  }
  stop() { this.stopped = true; if (this.timer) clearTimeout(this.timer); this.listeners.clear(); }
  subscribe(listener: (snapshot: Snapshot) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  async detail(path: string, maxBytes = DETAIL_BYTES) {
    if (!(await this.snapshot()).files.some(file => file.path === path)) throw new Error("Unknown session path");
    return readSessionDetail(this.root, path, maxBytes);
  }
  async timeline(project?: string, limit?: number) {
    return this.timelineCache.read(await this.snapshot(), project, limit);
  }
  async fingerprint(path:string,force=false) {
    if(!(await this.snapshot()).files.some(file=>file.path===path))throw new Error("Unknown session path");
    return this.fingerprints.read(this.root,path,force);
  }
  async preview(path: string) {
    const snapshot=await this.snapshot(), file=snapshot.files.find(file=>file.path===path);
    if(!file)throw new Error("Unknown session path");
    return file.message??{text:"",role:null,timestamp:null,truncated:false,lastEventAt:null};
  }
  async rename(path: string, name: string) {
    validateName(name);
    const write = this.writes.then(async () => {
      const snapshot = await this.snapshot();
      if (!snapshot.files.some(file => file.path === path)) throw new Error("Unknown session path");
      await this.source.rename(path, name);
      // Do not publish an in-flight pre-rename read as the rename result.
      if (this.pending) await this.pending;
      await this.refresh();
    });
    this.writes = write.catch(() => {});
    return write;
  }
}
