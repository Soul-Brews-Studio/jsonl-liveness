import { readSessionDetail, type DetailEvent } from "./details";
import { sessionId } from "./names";
import { latestMessages } from "./session-status";
import type { Snapshot } from "./source";

const TAIL_BYTES = 64 * 1024;
const MAX_SESSIONS = 50;
const MAX_ROWS = 200;
const MAX_TEXT = 3000;
const MAX_CONCURRENCY = 6;

export interface TimelineRow {
  id: string;
  path: string;
  sessionId: string;
  name: string | null;
  project: string;
  tier: string;
  timestamp: string | null;
  kind: DetailEvent["kind"];
  role: string;
  title: string;
  text: string;
  truncated: boolean;
}

export interface TimelineSnapshot {
  rows: TimelineRow[];
  scannedAt: string;
  filesConsidered: number;
  totalFiles: number;
  limitedSessions: boolean;
  tailBytes: number;
  maxSessions: number;
  limit: number;
  omittedRows: number;
  readErrors: number;
  reads: number;
}

interface CacheEntry {
  revision: string;
  events: DetailEvent[];
  failed: boolean;
}

function revision(file: Snapshot["files"][number]): string {
  return file.revision ?? `${file.mtimeMs ?? "unknown"}:${file.size}`;
}

function rowId(path: string, eventId: string): string {
  return JSON.stringify([path, eventId]);
}

export class TimelineCache {
  private entries = new Map<string, CacheEntry>();

  constructor(private root: string) {}

  async read(snapshot: Snapshot, project?: string | string[], limit = MAX_ROWS): Promise<TimelineSnapshot> {
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_ROWS) throw new Error("Timeline limit must be between 1 and 200");
    const eligible = latestMessages(snapshot.files).filter(file => project === undefined || (Array.isArray(project) ? project.includes(file.project) : file.project === project));
    const selected = eligible.slice(0, MAX_SESSIONS);
    const selectedPaths = new Set(selected.map(file => file.path));
    for (const path of this.entries.keys()) {
      if (!selectedPaths.has(path)) this.entries.delete(path);
    }

    let cursor = 0;
    let reads = 0;
    const results = new Array<CacheEntry>(selected.length);
    await Promise.all(Array.from({length: Math.min(MAX_CONCURRENCY, selected.length)}, async () => {
      while (cursor < selected.length) {
        const index = cursor++;
        const file = selected[index];
        const fileRevision = revision(file);
        const cached = this.entries.get(file.path);
        if (cached?.revision === fileRevision) {
          results[index] = cached;
          continue;
        }
        reads++;
        let entry: CacheEntry;
        try {
          const detail = await readSessionDetail(this.root, file.path, TAIL_BYTES, false);
          entry = {revision: fileRevision, events: detail.events, failed: false};
        } catch {
          entry = {revision: fileRevision, events: [], failed: true};
        }
        this.entries.set(file.path, entry);
        results[index] = entry;
      }
    }));

    const rows = selected.flatMap((file, index) => results[index].events.map(event => ({
      id: rowId(file.path, event.id),
      path: file.path,
      sessionId: sessionId(file.path),
      name: file.name ?? null,
      project: file.project,
      tier: file.tier,
      timestamp: event.timestamp,
      kind: event.kind,
      role: event.role,
      title: event.title,
      text: event.text.slice(0, MAX_TEXT),
      truncated: event.truncated || event.text.length > MAX_TEXT,
    } satisfies TimelineRow)));
    rows.sort((left, right) => {
      const leftTime = Date.parse(left.timestamp ?? "");
      const rightTime = Date.parse(right.timestamp ?? "");
      const leftValid = Number.isFinite(leftTime);
      const rightValid = Number.isFinite(rightTime);
      if (leftValid !== rightValid) return leftValid ? -1 : 1;
      if (leftValid && leftTime !== rightTime) return rightTime - leftTime;
      return left.id.localeCompare(right.id);
    });

    return {
      rows: rows.slice(0, limit),
      scannedAt: snapshot.scannedAt,
      filesConsidered: selected.length,
      totalFiles: eligible.length,
      limitedSessions: eligible.length > MAX_SESSIONS,
      tailBytes: TAIL_BYTES,
      maxSessions: MAX_SESSIONS,
      limit,
      omittedRows: Math.max(0, rows.length - limit),
      readErrors: results.filter(result => result.failed).length,
      reads,
    };
  }
}
