import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { TimelineSnapshot } from "../../timeline";
import type { Snapshot } from "../../source";
import type { Request } from "../useBackend";
import { localTime, shortProject } from "../model";
import {
  appendTimelineRows, isTimelineSnapshot, matchesTimelineCheckboxes,
  timelineLimit, type TimelineEventFilter, type TimelineSourceFilter,
} from "../timeline-model";

export interface TimelineProps {
  snapshot?:Snapshot; request:Request; active:boolean; paused:boolean;
  onPause:()=>void; onRefresh:()=>Promise<void>;
}
/** Full-page, inline events. The document owns the only scrolling surface. */
export function Timeline({snapshot,request,active,paused,onPause,onRefresh}:TimelineProps) {
  const [selectedProjects,setSelectedProjects]=useState<Set<string>|null>(null);
  const [query,setQuery]=useState("");
  const project=JSON.stringify(selectedProjects===null?null:[...selectedProjects].sort());
  const noProjects=selectedProjects?.size===0;
  const [limit,setLimit]=useState(()=>timelineLimit(new URL(location.href).searchParams.get("limit")));
  const [direction,setDirection]=useState("top");
  const [eventFilters,setEventFilters]=useState<Set<TimelineEventFilter>>(()=>new Set(["human","output","tools"]));
  const [sourceFilters,setSourceFilters]=useState<Set<TimelineSourceFilter>>(()=>new Set(["main","subagents"]));
  const [result,setResult]=useState<{scope:string;data:TimelineSnapshot}>();
  const [error,setError]=useState(""),[loading,setLoading]=useState(false),[manual,setManual]=useState(0);
  const [following,setFollowing]=useState(true),[newCount,setNewCount]=useState(0);
  const [fresh,setFresh]=useState<Set<string>>(()=>new Set());
  const followRef=useRef(true),lastManual=useRef(0);
  const feed=useRef<{scope:string;data:TimelineSnapshot;seen:Set<string>} | undefined>(undefined);
  const refreshing=useRef(false);
  const scope=JSON.stringify([project,limit]);
  const [seenProjects,setSeenProjects]=useState<Set<string>>(()=>new Set());
  const projects=useMemo(()=>[...seenProjects].sort(),[seenProjects]);
  useEffect(()=>{
    if(!result)return;
    setSeenProjects(current=>{
      const next=new Set(current);
      for(const row of result.data.rows)next.add(row.project);
      return next.size===current.size?current:next;
    });
  },[result]);
  // Cheap stat/name signature: no hashing or feed request on age-only ticks.
  const signature=useMemo(()=>JSON.stringify((snapshot?.files??[]).filter(file=>selectedProjects===null||selectedProjects.has(file.project))
    .slice(0,50).map(file=>[file.path,file.revision??`${file.mtimeMs}:${file.size}`,file.name])),[snapshot,project]);
  const data=result?.scope===scope?result.data:undefined;
  function follow(value:boolean){followRef.current=value;setFollowing(value);if(value)setNewCount(0);}
  function reset(){feed.current=undefined;setResult(undefined);setFresh(new Set());setNewCount(0);setError("");}
  useEffect(()=>{
    const restore=()=>{setLimit(timelineLimit(new URL(location.href).searchParams.get("limit")));};
    window.addEventListener("popstate",restore);return()=>window.removeEventListener("popstate",restore);
  },[]);
  useEffect(()=>{
    const forced=manual!==lastManual.current;lastManual.current=manual;
    if(noProjects||!active||!snapshot||refreshing.current||(paused&&!forced&&feed.current?.scope===scope)){setLoading(false);return;}
    const controller=new AbortController();let current=true;
    setLoading(true);setError("");
    const params=new URLSearchParams({limit:String(limit)});if(selectedProjects!==null)for(const value of selectedProjects)params.append("project",value);
    request(`/api/timeline?${params}`,{signal:controller.signal}).then(value=>{
      if(!current)return;
      if(!isTimelineSnapshot(value))throw new Error("Backend returned an invalid timeline");
      const old=feed.current?.scope===scope?feed.current:undefined;
      const added=old?value.rows.filter(row=>!old.seen.has(row.id)):[];
      const rows=appendTimelineRows(old?.data.rows??[],value.rows,limit,old?.seen);
      const next={...value,rows};
      feed.current={scope,data:next,seen:new Set([...value.rows,...rows].map(row=>row.id))};
      if(added.length){setFresh(new Set(added.map(row=>row.id)));if(!followRef.current)setNewCount(count=>Math.min(limit,count+added.length));}
      setResult({scope,data:next});
    }).catch(failure=>{if(current)setError(`Timeline unavailable: ${String(failure)}. Check the backend connection/version, then Refresh.`);})
      .finally(()=>{if(current)setLoading(false);});
    return()=>{current=false;controller.abort();};
  },[active,request,project,limit,scope,signature,paused,manual,!!snapshot]);
  useEffect(()=>{if(!fresh.size)return;const timer=setTimeout(()=>setFresh(new Set()),1600);return()=>clearTimeout(timer);},[fresh]);
  useLayoutEffect(()=>{
    if(active&&following&&data)window.scrollTo({top:direction==="bottom"?document.documentElement.scrollHeight:0,behavior:"instant"});
  },[data,following,direction,active]);
  useEffect(()=>{
    if(!active)return;
    const onScroll=()=>{
      const away=direction==="bottom"?document.documentElement.scrollHeight-window.innerHeight-window.scrollY>100:window.scrollY>100;
      if(away&&followRef.current)follow(false);
    };
    window.addEventListener("scroll",onScroll,{passive:true});return()=>window.removeEventListener("scroll",onScroll);
  },[active,direction]);
  async function refresh(){
    if(refreshing.current)return;
    refreshing.current=true;reset();setSeenProjects(new Set());
    try{await onRefresh();}finally{refreshing.current=false;setManual(value=>value+1);}
  }
  function chooseLimit(value:string){
    const next=timelineLimit(value);setLimit(next);reset();follow(true);
    const url=new URL(location.href);url.searchParams.set("limit",String(next));history.replaceState(null,"",url);
  }
  function toggleEvent(value:TimelineEventFilter){setEventFilters(current=>{const next=new Set(current);next.has(value)?next.delete(value):next.add(value);return next;});follow(false);}
  function toggleSource(value:TimelineSourceFilter){setSourceFilters(current=>{const next=new Set(current);next.has(value)?next.delete(value):next.add(value);return next;});follow(false);}
  const rows=(data?.rows??[]).filter(row=>(selectedProjects===null||selectedProjects.has(row.project)) && matchesTimelineCheckboxes(row,eventFilters,sourceFilters) &&
    `${row.project} ${row.sessionId} ${row.name??""} ${row.title} ${row.text}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const visible=direction==="bottom"?rows:rows.toReversed();
  return <section id="timeline" aria-label="Live event timeline" className="min-w-0">
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">Timeline</h2><p className="mt-1 text-sm text-muted">New events append {direction==="bottom"?"below":"at the top"} every 2 seconds. Times are recorded in the transcript, not file touches.</p></div><span id="timeline-live" className="text-xs text-muted">{paused?"Paused":loading?"Updating…":"Following complete events"}</span></div>
    <div className="mb-4 grid gap-3 md:grid-cols-[1fr_1fr_auto_auto]">
      <details id="timeline-project" open className="min-w-0 rounded-lg border border-line p-3">
        <summary className="cursor-pointer text-xs font-medium">Project / directory · {selectedProjects===null?"All":selectedProjects.size} selected</summary>
        <div className="my-3 flex gap-2">
          <button type="button" onClick={()=>{setSelectedProjects(null);reset();follow(false);}}>All</button>
          <button type="button" onClick={()=>{setSelectedProjects(new Set());reset();follow(false);}}>None</button>
        </div>
        <p className="mb-2 text-xs text-muted">Only projects seen in this feed. New arrivals appear here; Refresh clears the list.</p>
        <fieldset aria-label="Timeline projects" className="grid gap-2" style={{maxHeight:"16rem",overflowY:"auto"}}>
          {projects.length===0&&<p className="text-xs text-muted">No projects seen yet. Choose All to follow new arrivals.</p>}
          {projects.map(value=><label key={value} className="timeline-checkbox-label break-all">
            <input className="timeline-checkbox" type="checkbox" checked={selectedProjects===null||selectedProjects.has(value)}
              onChange={()=>{setSelectedProjects(current=>{const next=new Set(current??projects);next.has(value)?next.delete(value):next.add(value);return next;});reset();follow(false);}}/>{value}
          </label>)}
        </fieldset>
      </details>
      <label className="min-w-0 text-xs font-medium">Search this timeline<input id="timeline-search" type="search" placeholder="Message, project, name or session ID" value={query} onChange={event=>{setQuery(event.target.value);follow(false);}}/></label>
      <label className="text-xs font-medium">Events<select id="timeline-limit" className="mt-2" value={limit} onChange={event=>chooseLimit(event.target.value)}>{[20,50,100].map(value=><option key={value} value={value}>{value} events</option>)}</select></label>
      <label className="text-xs font-medium">New events<select id="timeline-direction" className="mt-2" value={direction} onChange={event=>{setDirection(event.target.value);follow(true);}}><option value="top">At the top ↑</option><option value="bottom">At the bottom ↓</option></select></label>
    </div>
    <div className="mb-4 flex flex-wrap gap-5">
      <fieldset id="timeline-event-filter"><legend className="mb-2 text-xs font-medium">Show events</legend><div className="flex flex-wrap gap-3" aria-label="Timeline event type filter">
        {(["human","output","tools"] as const).map(value=><label key={value} className="timeline-checkbox-label"><input id={`timeline-show-${value}`} className="timeline-checkbox" type="checkbox" checked={eventFilters.has(value)} onChange={()=>toggleEvent(value)}/>{({human:"Human",output:"AI output",tools:"Tools & other"} as const)[value]}</label>)}
      </div></fieldset>
      <fieldset id="timeline-source-filter"><legend className="mb-2 text-xs font-medium">Show sources</legend><div className="flex flex-wrap gap-3" aria-label="Timeline source filter">
        {(["main","subagents"] as const).map(value=><label key={value} className="timeline-checkbox-label"><input id={`timeline-show-${value}`} className="timeline-checkbox" type="checkbox" checked={sourceFilters.has(value)} onChange={()=>toggleSource(value)}/>{({main:"Main sessions",subagents:"Subagents & workflows"} as const)[value]}</label>)}
      </div></fieldset>
    </div>
    <div className="mb-3 flex flex-wrap items-center gap-2"><button id="timeline-pause" aria-pressed={paused} onClick={onPause}>{paused?"Resume":"Pause"}</button><button id="timeline-refresh" disabled={loading} onClick={()=>void refresh()} title="Clear this feed and load the latest selected batch">Refresh</button><button id="timeline-follow" aria-pressed={following} onClick={()=>follow(!following)}>{following?"Following latest":"Follow latest"}</button><span id="timeline-count" role="status" className="text-xs text-muted">{data?`${visible.length} / ${limit} events · ${data.filesConsidered} sessions`:noProjects?"No projects selected":"Waiting for events…"}</span></div>
    {error&&<p id="timeline-error" role="alert" className="mb-3 text-sm text-danger">{error}</p>}
    <div id="timeline-scroll" className="min-w-0">
      <table id="timeline-table" className="timeline-grid w-full table-fixed border-collapse text-left text-sm">
        <colgroup><col className="w-[20%]"/><col className="w-[15%]"/><col className="w-[20%]"/><col className="w-[45%]"/></colgroup>
        <thead className="bg-panel text-xs"><tr><th>Project / directory</th><th>Date / time</th><th>Session ID</th><th>Stream · multiline event</th></tr></thead>
        <tbody id="timeline-rows">{visible.map(row=><tr key={row.id} data-event-id={row.id} data-new={fresh.has(row.id)||undefined} className="align-top">
          <td><div className="timeline-meta"><div className="font-medium">{shortProject(row.project)}</div><div className="mt-1 break-words text-xs leading-5 text-muted">{row.project}</div></div></td>
          <td className="text-xs leading-6"><div className="timeline-meta"><time dateTime={row.timestamp??undefined}>{localTime(row.timestamp,"Not recorded")}</time></div></td>
          <td><div className="timeline-meta"><span className="block break-all font-mono text-xs">{row.sessionId}</span>{row.name&&<div className="mt-1 break-words text-sm">{row.name}</div>}<div className="mt-1 text-xs text-muted">{row.tier}</div></div></td>
          <td><div className="timeline-event"><div className="mb-2 flex shrink-0 flex-wrap justify-between gap-2 text-xs"><span className="font-medium text-accent">{row.title||row.role}{fresh.has(row.id)&&<span className="arrival-badge ml-2 font-normal">· New</span>}</span><span className="text-muted">{row.text.split(/\r?\n/).length} lines</span></div><div className="timeline-event-scroll" tabIndex={0} aria-label={`${row.title || row.role} event text`} onScroll={()=>follow(false)}><pre className={`m-0 whitespace-pre-wrap break-words text-sm leading-7 ${row.kind==="tool-use"||row.kind==="tool-result"?"font-mono":"font-sans"}`}>{row.text}</pre>{row.truncated&&<p className="mt-2 text-xs text-muted">Excerpt shortened to keep the live table responsive</p>}</div></div></td>
        </tr>)}</tbody>
      </table>
      {!visible.length&&<p id="timeline-empty" className="p-8 text-center text-sm text-muted">{loading?"Reading complete events…":error?"No timeline available.":"No matching events. Adjust the event/source filters, project, or search."}</p>}
    </div>
    <div className="sticky bottom-0 mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-line bg-canvas py-3">
      <span id="timeline-limits" className="text-xs leading-5 text-muted">Last {limit} events · up to 50 sessions · 64 KiB tail each. Older history may be omitted. Partial records wait for a newline.{data?.readErrors?` ${data.readErrors} files could not be read.`:""}</span>
      {newCount>0&&<button id="timeline-new" className="primary" onClick={()=>follow(true)}>{newCount} new {newCount===1?"entry":"entries"} · jump to latest</button>}
      <button id="timeline-top" onClick={()=>{follow(false);window.scrollTo({top:0,behavior:"instant"});}}>Back to controls ↑</button>
    </div>
  </section>;
}
