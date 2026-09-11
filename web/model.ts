import type { Snapshot } from "../source";
export type FileRow = Snapshot["files"][number];
export const fullID = (file: FileRow) => file.id || file.path.split("/").at(-1)!.replace(/\.jsonl$/, "");
export const shortProject = (project: string) => project.split("/").filter(Boolean).slice(-2).join("/");
export const localTime = (value: string | null | undefined, fallback = "Not recorded") => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : fallback;
export const lastWrite = (file: FileRow, scannedAt: string) => file.modifiedAt || new Date(file.mtimeMs ?? Date.parse(scannedAt) - file.age).toISOString();
export function age(ms: number): string {
  if (ms < 60_000) return `${Math.floor(ms/1000)}s`;
  if (ms < 3_600_000) return `${Math.floor(ms/60_000)}m`;
  if (ms < 86_400_000) return `${Math.floor(ms/3_600_000)}h`;
  return `${Math.floor(ms/86_400_000)}d`;
}
export const size = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024**2 ? `${Math.round(bytes/1024)} KB` : `${(bytes/1024**2).toFixed(1)} MB`;
export const eventLabel = (file: FileRow) => file.type ? `${file.type}${file.role && file.role !== file.type ? ` / ${file.role}` : ""}` : "No complete event";
export const classes = ["hot", "warm", "cool", "dead"] as const;
export function isSnapshot(value: unknown): value is Snapshot {
  if (!value || typeof value !== "object") return false;
  const data = value as Snapshot;
  return typeof data.scannedAt === "string" && Number.isFinite(Date.parse(data.scannedAt)) && typeof data.scanMs === "number" &&
    !!data.counts && classes.every(state=>typeof data.counts[state] === "number") && Array.isArray(data.errors) && data.errors.every(error=>typeof error === "string") &&
    Array.isArray(data.files) && data.files.every(file=>file && typeof file.path === "string" && typeof file.project === "string" && typeof file.tier === "string" && (file.revision == null || typeof file.revision === "string") &&
      classes.includes(file.class) && Number.isFinite(file.age) && Number.isFinite(file.size) && (file.name == null || typeof file.name === "string") && (file.id == null || typeof file.id === "string"));
}
