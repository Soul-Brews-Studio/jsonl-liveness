import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { isAbsolute, relative } from "node:path";

export const DETAIL_BYTES = 256 * 1024;
export const MAX_DETAIL_BYTES = 1024 * 1024;
const HEAD_BYTES = 64 * 1024;
const MAX_RECORDS = 100, MAX_EVENTS = 100, MAX_TEXT = 6000;
export interface DetailEvent {
  id: string;
  kind: "message" | "tool-use" | "tool-result" | "event";
  role: string;
  title: string;
  text: string;
  timestamp: string | null;
  truncated: boolean;
}
export interface SessionDetail {
  path: string;
  events: DetailEvent[];
  bytesRead: number;
  fileSize: number;
  recordsRead: number;
  malformedRecords: number;
  hasOlder: boolean;
  partialLineHeld: boolean;
  headBytesRead: number;
  startedAt: string | null;
  endedAt: string | null;
  lastEventAt: string | null;
  lastUpdatedAt: string;
}
function recordTimestamp(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const timestamp = (value as Record<string, unknown>).timestamp;
  if (typeof timestamp !== "string" || !Number.isFinite(Date.parse(timestamp))) return null;
  return new Date(timestamp).toISOString();
}
function textContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(part => {
    if (part && typeof part === "object" && part.type === "text") return typeof part.text === "string" ? part.text : "";
    if (part && typeof part === "object" && part.type === "image") return "[image omitted]";
    return "";
  }).filter(Boolean).join("\n");
  return "";
}
function recordEvents(value: unknown): DetailEvent[] {
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, any>;
  const message = record.message && typeof record.message === "object" ? record.message : record;
  const role = (typeof message.role === "string" ? message.role : typeof record.type === "string" ? record.type : "event").slice(0,40);
  const timestamp = recordTimestamp(record);
  const events: DetailEvent[] = [];
  function add(kind: DetailEvent["kind"], title: string, text: string) {
    events.push({id:"",kind,role,title:title.slice(0,160),text:text.slice(0,MAX_TEXT),timestamp,truncated:text.length>MAX_TEXT});
  }
  const content = message.content;
  if (typeof content === "string" && content.trim()) add("message",role,content);
  else if (Array.isArray(content)) {
    for (const block of content.slice(-MAX_EVENTS)) {
      if (!block || typeof block !== "object") continue;
      if (block.type === "text" && typeof block.text === "string") add("message",role,block.text);
      else if (block.type === "tool_use") add("tool-use",`Tool: ${typeof block.name === "string" ? block.name : "unknown"}`,JSON.stringify(block.input ?? {}, null, 2));
      else if (block.type === "tool_result") add("tool-result",block.is_error ? "Tool result · error" : "Tool result",textContent(block.content) || "[non-text result]");
      else if (block.type === "image") add("event","Image","[image omitted]");
      // Thinking/signature and binary payloads are deliberately not exposed.
    }
  }
  if (!events.length) {
    const summary = textContent(record.summary) || textContent(record.text);
    const subtype = typeof record.subtype === "string" ? record.subtype : "";
    if (record.type === "started" || record.type === "result") {
      const result = typeof record.result === "string" ? record.result : textContent(record.result?.result);
      const identity = [record.key, record.agentId].filter(value=>typeof value === "string").join(" · ");
      add("event",record.type === "started" ? "Workflow agent started" : "Workflow agent result",[identity,result].filter(Boolean).join("\n") || "Workflow event");
    } else if (summary || subtype) add("event",[role,subtype].filter(Boolean).join(" · "),summary || "Metadata event");
  }
  return events;
}

export async function openSessionFile(root:string,path:string) {
  const [canonicalRoot, canonicalFile] = await Promise.all([realpath(root), realpath(path)]);
  const local = relative(canonicalRoot, canonicalFile);
  if (!local || local === ".." || local.startsWith("../") || isAbsolute(local)) throw new Error("Session is outside the configured root");
  return open(canonicalFile, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
}
export async function readSessionDetail(root: string, path: string, maxBytes = DETAIL_BYTES, readStart = true): Promise<SessionDetail> {
  if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_DETAIL_BYTES) throw new Error("Detail byte limit is invalid");
  const file = await openSessionFile(root,path);
  try {
    const info = await file.stat();
    if (!info.isFile()) throw new Error("Session is not a regular file");
    // Discard the first possibly partial record when the window starts mid-file.
    const position = Math.max(0, info.size - maxBytes);
    const buffer = Buffer.alloc(Math.min(info.size, maxBytes));
    const {bytesRead} = await file.read(buffer,0,buffer.length,position);
    const bytes = buffer.subarray(0,bytesRead);
    // Start is the first timestamp visible in a bounded head, not file creation
    // time (which changes on copies). Reuse the tail if it already covers it.
    let head = bytes.subarray(0, HEAD_BYTES), headBytesRead = 0;
    if (readStart && position > 0) {
      head = Buffer.alloc(Math.min(info.size, HEAD_BYTES));
      const read = await file.read(head, 0, head.length, 0);
      headBytesRead = read.bytesRead; head = head.subarray(0, headBytesRead);
    }
    let startedAt: string | null = null;
    for (const line of readStart ? head.subarray(0, Math.max(0, head.lastIndexOf(10))).toString("utf8").split("\n") : []) {
      try { startedAt = recordTimestamp(JSON.parse(line)); } catch { continue; }
      if (startedAt) break;
    }
    const end = bytes.lastIndexOf(10);
    const first = position > 0 ? bytes.indexOf(10) + 1 : 0;
    const partialLineHeld = bytesRead > 0 && bytes[bytesRead-1] !== 10;
    const lines = end >= first ? bytes.subarray(first,end).toString("utf8").split("\n") : [];
    const selected = lines.slice(-MAX_RECORDS);
    let offset = position + first + lines.slice(0, lines.length-selected.length).reduce((total,line)=>total+Buffer.byteLength(line)+1,0);
    let malformedRecords = 0;
    let omittedBlocks = false;
    let endedAt: string | null = null, lastEventAt: string | null = null;
    const events: DetailEvent[] = [];
    for (const line of selected) {
      const recordOffset = offset; offset += Buffer.byteLength(line)+1;
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line);
        const timestamp = recordTimestamp(record);
        if (timestamp) lastEventAt = timestamp;
        // End-of-turn and workflow job results are not session ends. Only
        // explicit session-end markers count; subsequent conversation reopens it.
        const event = record?.type === "system" ? record.subtype : record?.type;
        if (event === "session_end" || event === "session-end") endedAt = timestamp;
        else if (["user", "assistant", "session_start", "session-start"].includes(event)) endedAt = null;
        const content = record?.message?.content ?? record?.content;
        if (Array.isArray(content) && content.length > MAX_EVENTS) omittedBlocks = true;
        events.push(...recordEvents(record).map((event,index)=>({...event,id:`${recordOffset}:${index}`})));
      }
      catch { malformedRecords++; }
    }
    return {path,events:events.slice(-MAX_EVENTS),bytesRead,headBytesRead,startedAt,endedAt,lastEventAt,lastUpdatedAt:info.mtime.toISOString(),fileSize:info.size,recordsRead:selected.length,malformedRecords,
      hasOlder:position>0 || lines.length>MAX_RECORDS || events.length>MAX_EVENTS || omittedBlocks,partialLineHeld};
  } finally { await file.close(); }
}
