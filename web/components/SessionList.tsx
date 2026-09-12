import { useState } from "react";
import { MessagePreview } from "./MessagePreview";
import type { Request } from "../useBackend";
import type { Snapshot } from "../../source";
import { age, classes, eventLabel, fullID, lastWrite, localTime, shortProject, size, type FileRow } from "../model";

export interface SessionListProps {
  snapshot?: Snapshot; selected: string; onSelect: (file: FileRow)=>void;
  paused: boolean; busy: boolean; onPause: ()=>void; onRefresh: ()=>void; table: boolean; request: Request;
}
export function SessionList({snapshot,selected,onSelect,paused,busy,onPause,onRefresh,table,request}:SessionListProps) {
  const [filter,setFilter]=useState("recent"),[query,setQuery]=useState(""),[page,setPage]=useState(0);
  const files=(snapshot?.files??[]).filter(file=>(filter==="all" || (filter==="recent" ? file.class!=="dead" : file.class===filter)) &&
    `${file.name||""} ${fullID(file)} ${file.project} ${file.tier}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const current=Math.max(0,Math.min(page,Math.ceil(files.length/50)-1)), start=current*50;
  return <section className="flex min-h-0 min-w-0 flex-col xl:h-full" aria-label="Sessions">
    <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2"><h2 className="font-semibold">Sessions</h2><span id="total" className="text-xs text-muted">{snapshot?`${snapshot.files.length.toLocaleString()} files · ${new Set(snapshot.files.map(file=>file.project)).size} projects`:"Waiting for backend"}</span></div>
    <div className="mb-4 flex flex-wrap gap-1" aria-label="Filter by freshness">{["recent","all",...classes].map(value=><button key={value} data-filter={value} aria-pressed={filter===value} className="filter-button capitalize" onClick={()=>{setFilter(value);setPage(0);}}>{value}{classes.includes(value as typeof classes[number]) && <span id={`count-${value}`} className="ml-1 text-xs">{snapshot?.counts[value as typeof classes[number]]??"—"}</span>}</button>)}</div>
    <label className="block text-xs font-medium">Search<input id="search" type="search" placeholder="Name, ID, project or tier" value={query} onChange={e=>{setQuery(e.target.value);setPage(0);}}/></label>
    <div className="my-3 flex gap-2"><button id="pause" aria-pressed={paused} onClick={onPause}>{paused?"Resume":"Pause"}</button><button id="refresh" disabled={busy} onClick={onRefresh}>Refresh</button></div>
    <div id="session-table-scroll" className="max-h-[65vh] min-h-0 overflow-auto xl:max-h-none xl:flex-1 rounded-lg border border-line">
      <table className={`w-full text-left text-xs ${table?"min-w-[1000px]":"table-fixed"}`}><thead className="sticky top-0 z-10 bg-panel"><tr><th className="p-3">Name / session ID</th>{table&&<><th>Project</th><th>Freshness</th><th>Last event</th><th>Recent message</th><th title="Filesystem write time, not the message timestamp">File updated</th><th className="pr-3 text-right">Size</th></>}</tr></thead>
      <tbody id="rows">{files.slice(start,start+50).map(file=><tr key={file.path} data-selected={selected===file.path} className="session-row cursor-pointer border-t border-line" onClick={()=>onSelect(file)}>
        <td className="p-3"><button className="session-button w-full truncate border-0 bg-transparent p-0 text-left font-semibold" data-session-path={file.path} aria-pressed={selected===file.path} title={fullID(file)} onClick={e=>{e.stopPropagation();onSelect(file);}}>{file.name||fullID(file).slice(0,18)}</button>
          <span className="mt-1 block truncate text-xs text-muted">{shortProject(file.project)} · <span className={`freshness ${file.class}`}>{file.class}</span></span>
          <span className="mt-1 block truncate font-mono text-[10px] text-muted">{file.name?fullID(file):file.tier}</span>
          {!table&&<time className="mt-2 block text-[11px] text-muted" dateTime={lastWrite(file,snapshot!.scannedAt)} title={localTime(lastWrite(file,snapshot!.scannedAt))}>Updated {age(file.age)} ago · {new Date(lastWrite(file,snapshot!.scannedAt)).toLocaleTimeString()}</time>}
        </td>{table&&<><td className="px-2 text-muted">{shortProject(file.project)}</td><td className={`freshness ${file.class} px-2 capitalize`}>{file.class}</td><td className="px-2 text-muted">{eventLabel(file)}</td><td className="px-3"><MessagePreview path={file.path} revision={file.revision??`${file.size}:${lastWrite(file,snapshot!.scannedAt)}`} request={request}/></td><td className="px-2 whitespace-nowrap"><time dateTime={lastWrite(file,snapshot!.scannedAt)}>{localTime(lastWrite(file,snapshot!.scannedAt))}</time><span className="block text-muted">{age(file.age)} ago</span></td><td className="p-3 text-right font-mono">{size(file.size)}</td></>}
      </tr>)}</tbody></table>
    </div>
    <p id="empty" hidden={!snapshot||files.length>0} className="my-8 text-center text-sm text-muted">No matching sessions. Choose All or clear your search.</p>
    <nav className="mt-3 flex shrink-0 flex-wrap items-center justify-between gap-2 text-xs text-muted" aria-label="Session pages"><span id="page-label">{snapshot?`${files.length?start+1:0}–${Math.min(start+50,files.length)} of ${files.length} matching`:"Waiting for backend…"}</span><div className="flex gap-1"><button id="previous" disabled={current===0} onClick={()=>setPage(current-1)}>Previous</button><button id="next" disabled={start+50>=files.length} onClick={()=>setPage(current+1)}>Next</button></div></nav>
  </section>;
}
