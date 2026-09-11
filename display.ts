import { basename } from "node:path";
import type { Names } from "./names";
import type { scan } from "./liveness";

type Snapshot = Awaited<ReturnType<typeof scan>>;
const clean = (text: string) => text.replace(/[\x00-\x1f\x7f-\x9f]/g, "?");
export function shortProject(project: string): string {
  return project.split("/").filter(Boolean).slice(-2).join("/") || project;
}
export function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)}K`;
  return `${(bytes / 1024 ** 2).toFixed(1)}M`;
}
export function ageLabel(ms: number): string {
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h`;
  return `${Math.floor(ms / 86_400_000)}d`;
}
function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], {hour: "2-digit", minute: "2-digit", hour12: false});
}
export function render(snapshot: Snapshot, limit = Infinity, names: Names = {}): string {
  const sessions = snapshot.files.filter(file => file.tier === "session").length;
  const projects = new Set(snapshot.files.map(file => file.project)).size;
  const lines = [
    `jsonl liveness — ${new Date(snapshot.scannedAt).toLocaleDateString()} · ${clock(Date.parse(snapshot.scannedAt))} local`,
    `${sessions} sessions · ${snapshot.files.length - sessions} agent/journal files · ${projects} projects · scan ${snapshot.scanMs}ms`,
    Object.entries(snapshot.counts).map(([name, count]) => `${name} ${count}`).join(" · "),
    "",
    "WRITE  NAME / PROJECT            SESSION/AGENT     KIND      CLASS  AGE    SIZE  LAST EVENT",
  ];
  const shown = snapshot.files.slice(0, Math.max(0, limit));
  for (const file of shown) {
    const id = basename(file.path, ".jsonl").replace(/^agent-/, "").slice(0, 8);
    const identity = file.tier === "session" ? id : file.tier === "workflow-journal" ? "journal" : `agent ${id}`;
    const kind = file.tier.startsWith("workflow") ? "workflow" : file.tier === "subagent" ? "subagent" : "session";
    const event = file.type ? `${file.type}${file.role && file.role !== file.type ? ` (${file.role})` : ""}` : "—";
    const column = (value: string, width: number) => clean(value).slice(0, width).padEnd(width);
    lines.push(`${clock(Date.parse(snapshot.scannedAt) - file.age)}  ${column(names[file.path] || shortProject(file.project), 24)}  ${column(identity, 16)}  ${column(kind, 8)}  ${column(file.class, 5)}  ${ageLabel(file.age).padStart(3)}  ${sizeLabel(file.size).padStart(6)}  ${clean(event)}`);
  }
  if (shown.length < snapshot.files.length) lines.push(`… ${snapshot.files.length - shown.length} older files hidden; --once shows all, --once --json includes full paths.`);
  lines.push("Freshness = last file write, not human input or process health.");
  return lines.join("\n");
}
