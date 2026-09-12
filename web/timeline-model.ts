import type { TimelineSnapshot } from "../timeline";

export const timelineEventFilters = ["human", "output", "tools"] as const;
export type TimelineEventFilter = typeof timelineEventFilters[number];
export const timelineSourceFilters = ["main", "subagents"] as const;
export type TimelineSourceFilter = typeof timelineSourceFilters[number];

/** A human is a user text message; every other message is agent output. */
export function timelineEventGroup(row: TimelineSnapshot["rows"][number]): TimelineEventFilter {
  if (row.kind !== "message") return "tools";
  return row.role.toLocaleLowerCase() === "user" ? "human" : "output";
}

/** Workflow journals and workflow agents belong with subagents, never main sessions. */
export function timelineSourceGroup(row: TimelineSnapshot["rows"][number]): TimelineSourceFilter {
  return row.tier === "session" ? "main" : "subagents";
}

/** Checkbox filters are intentionally composable: no checked group means no rows. */
export function matchesTimelineCheckboxes(
  row: TimelineSnapshot["rows"][number],
  eventGroups: ReadonlySet<TimelineEventFilter>,
  sourceGroups: ReadonlySet<TimelineSourceFilter>,
): boolean {
  return eventGroups.has(timelineEventGroup(row)) && sourceGroups.has(timelineSourceGroup(row));
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

/** Seed chronologically, then keep existing rows in place and append new arrivals. */
export function appendTimelineRows(previous:TimelineSnapshot["rows"], incoming:TimelineSnapshot["rows"], limit:number, seen:ReadonlySet<string>=new Set(previous.map(row=>row.id))):TimelineSnapshot["rows"] {
  const latest=new Map(incoming.map(row=>[row.id,row]));
  const additions=[...latest.values()].filter(row=>!seen.has(row.id))
    .sort((a,b)=>(Date.parse(a.timestamp??"")||0)-(Date.parse(b.timestamp??"")||0));
  return [...previous.map(row=>latest.get(row.id)??row),...additions].slice(-limit);
}
export function timelineLimit(value:string|null):number {
  const limit=Number(value);return [20,50,100].includes(limit)?limit:50;
}
