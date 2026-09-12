import { openLabel } from "../../session-status";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { SessionDetail } from "../../details";
import { eventLabel, fullID, localTime, shortProject, type FileRow } from "../model";
import type { Request } from "../useBackend";
import { ActivityEvent } from "./ActivityEvent";
import { NameForm } from "./NameForm";
import { HashCheck } from "./HashCheck";
import { SessionTiming } from "./SessionTiming";
export interface ConversationProps {file:FileRow;updated:string;request:Request;onNamed:()=>void;paused:boolean;popup?:boolean;scrollTarget?:string}
export function Conversation({file,updated,request,onNamed,paused,popup=false,scrollTarget}:ConversationProps) {
  const [data,setData]=useState<SessionDetail>(),[error,setError]=useState(""),[loading,setLoading]=useState(true);
  const [budget,setBudget]=useState(256*1024),[revision,setRevision]=useState(0),[following,setFollowing]=useState(popup);
  const externalScroll=popup||!!scrollTarget;
  const [newestFirst,setNewestFirst]=useState(false);
  const list=useRef<HTMLDivElement>(null),nearBottom=useRef(true);
  useEffect(()=>{
    const controller=new AbortController();let current=true;setLoading(true);setError("");
    request(`/api/session/detail?path=${encodeURIComponent(file.path)}&bytes=${budget}`,{signal:controller.signal}).then(value=>{
      if(!current)return;
      const next=value as SessionDetail;
      if(!next||next.path!==file.path||!Array.isArray(next.events))throw new Error("Backend returned invalid session details");
      setData(next);
    }).catch(error=>{if(current)setError(`Details unavailable: ${String(error)}`);}).finally(()=>{if(current)setLoading(false);});
    return()=>{current=false;controller.abort();};
  },[request,file.path,file.size,file.revision,updated,budget,revision]);
  function scrollContainer(){return externalScroll?document.getElementById(popup?"live-scroll":scrollTarget!):list.current;}
  function followLatest(){
    const container=scrollContainer(),last=list.current?.lastElementChild;
    if(!container||!last)return;
    if(newestFirst)container.scrollTop=0;
    else if(externalScroll)container.scrollTop+=last.getBoundingClientRect().bottom-container.getBoundingClientRect().bottom+24;
    else container.scrollTop=container.scrollHeight;
  }
  useLayoutEffect(()=>{if(following&&nearBottom.current)followLatest();},[data,following,popup,scrollTarget,newestFirst]);
  useEffect(()=>{
    const container=scrollContainer();
    const onScroll=()=>{
      if(!container||!list.current)return;
      nearBottom.current=newestFirst?container.scrollTop<80:externalScroll?list.current.getBoundingClientRect().bottom-container.getBoundingClientRect().bottom<80:container.scrollHeight-container.clientHeight-container.scrollTop<80;
      if(!nearBottom.current)setFollowing(false);
    };
    container?.addEventListener("scroll",onScroll);
    return()=>container?.removeEventListener("scroll",onScroll);
  },[popup,scrollTarget,newestFirst]);
  const latestTool=data?.events.findLast(event=>event.kind==="tool-use"||event.kind==="tool-result")?.id;
  const status=error || (loading?"Reading recent messages…":data?.events.length
    ? `${data.events.length} entries · ${Math.ceil(data.bytesRead/1024)} KiB tail${data.headBytesRead?` + ${Math.ceil(data.headBytesRead/1024)} KiB head`:""}${data.hasOlder?" · older history omitted":""}${data.partialLineHeld?" · partial line held back":""}${data.malformedRecords?` · ${data.malformedRecords} malformed records skipped`:""}`
    : `No readable messages in this tail.${data?.hasOlder?" Try the larger window.":""}${data?.partialLineHeld?" Incomplete last line held back.":""}`);
  return <section id="detail" aria-label="Selected session conversation" className="min-w-0">
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h2 id="detail-name" className="break-words text-xl font-semibold">{file.name||shortProject(file.project)||"Unnamed session"}</h2><p id="detail-session" className="mt-2 break-all font-mono text-xs text-muted">{fullID(file)}</p></div><span className="rounded-full border border-line px-3 py-1 text-xs text-muted">{paused?"Paused":"Live · every 2s"}</span></div>
    <p className="mt-3 text-sm" id="detail-presence">{openLabel(file)} <span className="text-xs text-muted">· Not a working/idle indicator</span></p>
    <p className="mt-2 text-xs text-muted">Latest message: {localTime(file.message?.timestamp,"Not found in the last 64 KiB")}</p>
    <SessionTiming detail={data} updated={updated} loading={loading&&!data}/>
    <div className="mb-2 flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">Recent activity</h3><div className="flex gap-2"><button id="activity-follow" aria-pressed={following} onClick={()=>{setFollowing(!following);nearBottom.current=true;if(!following)followLatest();}}>{following?"Following latest":"Follow latest"}</button><button id="activity-refresh" onClick={()=>setRevision(value=>value+1)}>Refresh</button></div></div>
    {popup&&<div className="mb-3 flex flex-wrap items-center gap-3"><label className="flex items-center gap-2 text-xs text-muted">Order<select id="activity-order" value={newestFirst?"newest":"oldest"} onChange={event=>{setNewestFirst(event.target.value==="newest");nearBottom.current=true;setFollowing(true);}}><option value="oldest">Oldest first</option><option value="newest">Newest first</option></select></label><button id="activity-jump" onClick={()=>{nearBottom.current=true;setFollowing(true);followLatest();}}>Jump to latest</button></div>}
    <p id="activity-status" role="status" className="mb-3 text-xs leading-5 text-muted">{status}</p>
    <div id="activity-list" ref={list} tabIndex={0} aria-label={newestFirst?"Conversation, newest to oldest":"Conversation, oldest to newest"} className={externalScroll?"min-h-52":"max-h-[56vh] min-h-52 overflow-auto pr-3 [scrollbar-gutter:stable]"}>
      {(newestFirst?data?.events.toReversed():data?.events)?.map(event=><ActivityEvent key={event.id} event={event} defaultExpanded={popup&&event.id===latestTool} unbounded={externalScroll} onToolToggle={()=>setFollowing(false)}/>)}
    </div>
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4"><button id="activity-more" disabled={budget>=1024*1024} onClick={()=>setBudget(1024*1024)}>Read larger tail (1 MiB)</button><span className="text-xs text-muted">Read-only. Continue the conversation in your terminal.</span></div>
    <details className="mt-6 rounded-lg border border-line bg-panel p-4"><summary className="cursor-pointer text-sm text-muted">File metadata</summary><dl className="metadata mt-4 grid grid-cols-[100px_minmax(0,1fr)] gap-3 text-xs"><dt>Session ID</dt><dd id="detail-id">{fullID(file)}</dd><dt>Project</dt><dd id="detail-project">{file.project}</dd><dt>Tier</dt><dd id="detail-tier">{file.tier}</dd><dt>Last write</dt><dd id="detail-write">{localTime(updated)}</dd><dt>Last complete event</dt><dd id="detail-event">{eventLabel(file)}</dd><dt>File path</dt><dd id="detail-path" className="font-mono">{file.path}</dd></dl></details>
    <HashCheck file={file} request={request}/>
    <NameForm key={file.path} file={file} request={request} onSaved={onNamed}/>
  </section>;
}
