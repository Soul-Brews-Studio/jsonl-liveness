import type { TimelineRow, TimelineSnapshot } from "./timeline";

const PROJECT_COLORS = [
  "\x1b[38;2;125;211;252m",
  "\x1b[38;2;196;181;253m",
  "\x1b[38;2;134;239;172m",
  "\x1b[38;2;253;186;116m",
  "\x1b[38;2;249;168;212m",
  "\x1b[38;2;147;197;253m",
  "\x1b[38;2;216;180;254m",
  "\x1b[38;2;190;242;100m",
] as const;
const LIGHT_TEXT = "\x1b[38;2;230;237;243m";
const CONTROL_CODES = /[\x00-\x1f\x7f-\x9f]/g;

export interface TuiTimelineOptions {
  rows: TimelineRow[];
  selected: number;
  width: number;
  height: number;
  footer: string;
  paused: boolean;
  following: boolean;
  eventGroups: ReadonlySet<string>;
  sourceGroups: ReadonlySet<string>;
  project: string;
  limit: number;
  loading: boolean;
  error: string;
}

function safe(value: string): string {
  return value.replace(CONTROL_CODES, "?");
}

function chars(value: string): string[] {
  return Array.from(value);
}

function clip(value: string, width: number): string {
  return chars(safe(value)).slice(0, width).join("");
}

function projectLabel(project: string): string {
  return project.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) || project || "unknown project";
}

function projectBucket(label: string): number {
  const name = label.replaceAll("\\", "/").split("/").filter(Boolean).at(-1)?.trim().toLowerCase() ?? "";
  let bucket = 0;
  for (const character of name) bucket = (Math.imul(bucket, 31) + character.codePointAt(0)!) >>> 0;
  return ((bucket ^ (bucket >>> 16)) >>> 0) % PROJECT_COLORS.length;
}

function wrapFooter(value: string, width: number): string[] {
  let remaining = chars(safe(value));
  if (!remaining.length) return [""];
  const lines: string[] = [];
  while (remaining.length && lines.length < 2) {
    if (remaining.length <= width) {
      lines.push(remaining.join(""));
      break;
    }
    let split = remaining.length <= width * 2 ? Math.ceil(remaining.length / 2) : width;
    while (split > 0 && remaining[split] !== " ") split--;
    if (!split) split = width;
    lines.push(remaining.slice(0, split).join("").trimEnd());
    remaining = remaining.slice(split);
    while (remaining[0] === " ") remaining.shift();
  }
  return lines;
}

function coloredProjectLine(prefix: string, project: string, suffix: string, width: number): string {
  const safePrefix = safe(prefix);
  const safeProject = safe(project);
  const plain = clip(safePrefix + safeProject + safe(suffix), width);
  const projectStart = chars(safePrefix).length;
  const projectEnd = projectStart + chars(safeProject).length;
  const visibleLength = chars(plain).length;
  if (projectStart >= visibleLength || projectEnd <= projectStart) return plain;
  const plainChars = chars(plain);
  const visibleEnd = Math.min(projectEnd, visibleLength);
  return plainChars.slice(0, projectStart).join("")
    + PROJECT_COLORS[projectBucket(safeProject)]
    + plainChars.slice(projectStart, visibleEnd).join("")
    + LIGHT_TEXT
    + plainChars.slice(visibleEnd).join("");
}

function eventGroup(row: TimelineRow): "human" | "output" | "tools" {
  if (row.kind !== "message") return "tools";
  return row.role.toLocaleLowerCase() === "user" ? "human" : "output";
}

function sourceGroup(row: TimelineRow): "main" | "subagents" {
  return row.tier === "session" ? "main" : "subagents";
}

/** Pure, composable filtering for the bounded timeline feed. */
export function matchingTimelineRows(
  rows: TimelineSnapshot["rows"],
  eventGroups: ReadonlySet<string>,
  sourceGroups: ReadonlySet<string>,
  project: string,
  query: string,
): TimelineRow[] {
  const needle = query.trim().toLocaleLowerCase();
  return rows.filter(row => {
    if (!eventGroups.has(eventGroup(row)) || !sourceGroups.has(sourceGroup(row))) return false;
    if (project && row.project !== project) return false;
    if (!needle) return true;
    return [row.name ?? "", row.project, row.sessionId, row.path, row.tier, row.kind, row.role, row.title, row.text]
      .some(value => value.toLocaleLowerCase().includes(needle));
  });
}

function timestamp(value: string | null): string {
  if (!value) return "time unknown";
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return "time unknown";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())} ${pad(parsed.getHours())}:${pad(parsed.getMinutes())}:${pad(parsed.getSeconds())}`;
}

function wrapPreview(row: TimelineRow, width: number): [string, string] {
  const logicalLines = `${safe(row.title)} — ${row.text}`.split(/\r?\n/).map(safe);
  const wrapped: string[] = [];
  for (const logicalLine of logicalLines) {
    const lineChars = chars(logicalLine);
    if (!lineChars.length) wrapped.push("");
    for (let index = 0; index < lineChars.length; index += width) {
      wrapped.push(lineChars.slice(index, index + width).join(""));
    }
  }
  if (!wrapped.length) wrapped.push("");
  const shortened = row.truncated || wrapped.length > 2;
  const first = clip(`  ${wrapped[0]}`, width);
  let second = clip(`  ${wrapped[1] ?? ""}`, width);
  if (shortened) {
    const notice = "… truncated → Enter detail";
    const available = Math.max(0, width - chars(notice).length);
    second = clip(second, available) + clip(notice, width);
    second = clip(second, width);
  }
  return [first, second];
}

/** Render a terminal-safe, bounded live event timeline. Each visible event occupies three lines. */
export function renderTuiTimeline(options: TuiTimelineOptions): string {
  const width = Math.max(1, Math.floor(options.width) - 1);
  const height = Math.max(1, Math.floor(options.height) - 1);
  const rows = options.rows;
  const selected = rows.length ? Math.max(0, Math.min(Math.floor(options.selected), rows.length - 1)) : 0;
  const footerLines = wrapFooter(options.footer, width);
  const fixedLines = 5 + footerLines.length;
  const rowCapacity = Math.max(0, Math.floor((height - fixedLines) / 3));
  const offset = rowCapacity ? Math.max(0, Math.min(selected - rowCapacity + 1, rows.length - rowCapacity)) : 0;
  const visible = rows.slice(offset, offset + rowCapacity);
  const eventLabel = [...options.eventGroups].join("+") || "none";
  const sourceLabel = [...options.sourceGroups].join("+") || "none";
  const lines: string[] = [
    clip(`JSONL LIVE TIMELINE · ${options.paused ? "PAUSED" : "every 2s"} · ${options.following ? "FOLLOW" : "manual"} · times local`, width),
    clip(`Project ${options.project || "All"} · events ${eventLabel} · sources ${sourceLabel} · limit ${options.limit}`, width),
    clip(`1 [${options.eventGroups.has("human")?"x":" "}] Human · 2 [${options.eventGroups.has("output")?"x":" "}] AI · 3 [${options.eventGroups.has("tools")?"x":" "}] Tools · 4 [${options.sourceGroups.has("main")?"x":" "}] Main · 5 [${options.sourceGroups.has("subagents")?"x":" "}] Subagents`, width),
    clip(`${rows.length ? offset + 1 : 0}–${Math.min(rows.length, offset + visible.length)} of ${rows.length} matching events`, width),
  ];

  for (let index = 0; index < visible.length; index++) {
    const row = visible[index];
    const absoluteIndex = offset + index;
    const marker = absoluteIndex === selected ? ">" : " ";
    const group = eventGroup(row).toUpperCase();
    const label = projectLabel(row.project);
    lines.push(coloredProjectLine(
      `${marker} ${timestamp(row.timestamp)} · `,
      label,
      ` · ${safe(row.sessionId)} · ${group}`,
      width,
    ));
    lines.push(...wrapPreview(row, width));
  }

  if (!visible.length) {
    const state = options.error ? `Error: ${options.error}` : options.loading ? "Loading live timeline…" : "No matching timeline events.";
    lines.push(clip(state, width));
  }
  const status = options.error ? `Error: ${options.error}` : options.loading ? "Loading complete events…" : "Complete events · Enter opens detail";
  lines.push(clip(status, width), ...footerLines);
  return lines.slice(0, height).join("\n");
}
