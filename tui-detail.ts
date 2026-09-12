import type { SessionDetail } from "./details";
import { sessionId } from "./names";
import { shortProject } from "./display";
import type { Snapshot } from "./source";

type File = Snapshot["files"][number];
const safe = (text: string) => text.replace(/[\x00-\x1f\x7f-\x9f]/g, "?");
const time = (value: string | null | undefined) => value ? new Date(value).toLocaleString() : "Not recorded";
export interface DetailView {
  path: string; file?: File; name?: string; data?: SessionDetail; error?: string;
  loading: boolean; paused: boolean; following: boolean; newestFirst: boolean;
  offset: number; width: number; height: number;
}
/** Bounded plain-text frame. Transcript control codes can never reach the terminal. */
export function renderTuiDetail(view: DetailView) {
  const width=Math.max(1,view.width-1),limit=Math.max(1,view.height-9),body:string[]=[];
  const wrap=(text:string)=>{
    for(const line of text.split(/\r?\n/)) {
      const chars=Array.from(safe(line));
      if(!chars.length)body.push("");
      for(let i=0;i<chars.length;i+=width)body.push(chars.slice(i,i+width).join(""));
    }
  };
  const events=view.newestFirst?view.data?.events.toReversed():view.data?.events;
  for(const event of events??[]) {
    wrap(`${event.title} · ${time(event.timestamp)}`);wrap(event.text);
    if(event.truncated)wrap("[text shortened to 6,000 characters]");
    body.push("");
  }
  if(!body.length)wrap(view.loading?"Reading live messages…":"No readable messages in this tail.");
  const maxOffset=Math.max(0,body.length-limit);
  const offset=view.following?(view.newestFirst?0:maxOffset):Math.max(0,Math.min(view.offset,maxOffset));
  const header=[
    `JSONL LIVE DETAIL · ${view.paused?"PAUSED":"every 1s"} · Esc back`,
    `${view.name||shortProject(view.file?.project??"")||"Unnamed"} · ${sessionId(view.path)}`,
    `Start ${time(view.data?.startedAt)} · End ${time(view.data?.endedAt)}`,
    `File updated ${time(view.data?.lastUpdatedAt??view.file?.modifiedAt)} · ${view.file?.class??"unavailable"}`,
    "",
  ];
  const status=view.error||`${view.newestFirst?"Newest first":"Oldest first"} · ${view.following?"FOLLOW":"manual"} · ${offset+1}–${Math.min(body.length,offset+limit)}/${body.length} lines${view.data?.partialLineHeld?" · partial line held":""}${view.data?.hasOlder?" · older history omitted":""}`;
  const lines=[...header,...body.slice(offset,offset+limit),"",status,"Esc back · q quit · t theme · ↑↓/jk scroll · PgUp/Dn · f follow · o order · p pause"];
  return {offset,maxOffset,limit,text:lines.slice(0,Math.max(1,view.height-1)).map(line=>Array.from(safe(line)).slice(0,width).join("")).join("\n")};
}
