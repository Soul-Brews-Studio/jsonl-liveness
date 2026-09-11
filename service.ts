import { localSource, type SessionSource, type Snapshot } from "./source";
import { defaults, type Thresholds } from "./liveness";
import { readSessionDetail, DETAIL_BYTES } from "./details";
import { FingerprintCache } from "./fingerprint";
import { namesPath, validateName } from "./names";

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
  private previews = new Map<string, {revision:string;value:{text:string;role:string|null;timestamp:string|null;truncated:boolean}}>();
  error: string | undefined;
  constructor(private root: string, thresholds: Thresholds = defaults, store = namesPath) {
    this.source = localSource(root, thresholds, store);
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
      if (!this.stopped) this.timer = setTimeout(tick, Math.max(100, 1000 - (performance.now() - start)));
    };
    this.timer = setTimeout(tick, 1000);
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
  async fingerprint(path:string,force=false) {
    if(!(await this.snapshot()).files.some(file=>file.path===path))throw new Error("Unknown session path");
    return this.fingerprints.read(this.root,path,force);
  }
  async preview(path: string) {
    const snapshot=await this.snapshot(), file=snapshot.files.find(file=>file.path===path);
    if(!file)throw new Error("Unknown session path");
    const revision=file.revision??`${file.size}:${file.mtimeMs??Date.parse(snapshot.scannedAt)-file.age}`;
    const cached=this.previews.get(path);if(cached?.revision===revision)return cached.value;
    const detail=await readSessionDetail(this.root,path,64*1024,false);
    const message=detail.events.findLast(event=>event.kind==="message" && ["user","assistant"].includes(event.role));
    const value={text:message?.text.slice(0,240)??"",role:message?.role??null,timestamp:message?.timestamp??null,truncated:!!message&&(message.truncated||message.text.length>240)};
    if(this.previews.size>=200)this.previews.delete(this.previews.keys().next().value!);
    this.previews.set(path,{revision,value});return value;
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
