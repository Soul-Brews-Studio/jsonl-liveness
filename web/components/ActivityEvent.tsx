import { useState } from "react";
import type { DetailEvent } from "../../details";
import { localTime } from "../model";

/** Safe, reusable renderer: transcript text is never interpreted as HTML. */
export function ActivityEvent({event,defaultExpanded=false,unbounded=false,onToolToggle}:{event:DetailEvent;defaultExpanded?:boolean;unbounded?:boolean;onToolToggle?:()=>void}) {
  const [expanded,setExpanded]=useState(defaultExpanded);
  const [raw,setRaw]=useState(false),[copied,setCopied]=useState("");
  const tool=event.kind==="tool-use"||event.kind==="tool-result";
  let command:string|undefined;
  if(event.kind==="tool-use")try{const input=JSON.parse(event.text);if(typeof input.command==="string")command=input.command;}catch{}
  const text=command&&!raw?command:event.text;
  const body=<><div className="mb-2 flex items-center justify-between gap-2 text-xs text-muted"><span>{event.kind==="tool-use"?"Input":"Output"}{event.truncated?" · shortened":""}</span><div className="flex gap-2">{command&&<button className="px-2 py-1 text-xs" aria-pressed={raw} onClick={()=>setRaw(!raw)}>{raw?"Command":"Raw"}</button>}<button className="px-2 py-1 text-xs" onClick={async()=>{try{await window.navigator.clipboard.writeText(text);setCopied("Copied");}catch{setCopied("Copy unavailable");}}}>{copied||"Copy"}</button></div></div><pre className={`${unbounded?"":"max-h-80 overflow-auto"} whitespace-pre-wrap break-words rounded-md bg-code p-3 font-mono text-xs leading-6 text-ink`}>{text}</pre></>;
  return <article className={`activity-event py-5 ${tool?"":"border-b border-line"}`} data-kind={event.kind} data-role={event.role}>
    {tool?<details open={expanded} onToggle={event=>setExpanded(event.currentTarget.open)} data-event-id={event.id} className="rounded-lg border border-line bg-panel p-4"><summary onClick={onToolToggle} className="cursor-pointer text-sm font-semibold"><span>{event.title}</span><span className="ml-3 font-normal text-muted">{event.timestamp?new Date(event.timestamp).toLocaleTimeString():""}</span></summary><div className="mt-4">{body}</div></details>:<><div className="mb-3 flex flex-wrap items-baseline justify-between gap-2"><strong className={`text-sm ${event.role==="user"?"text-accent":"text-ink"}`}>{event.title}</strong>{event.timestamp&&<time className="text-xs text-muted" dateTime={event.timestamp} title={localTime(event.timestamp)}>{new Date(event.timestamp).toLocaleTimeString()}</time>}</div><div className="whitespace-pre-wrap break-words text-[15px] leading-7">{event.text}</div></>}
    {event.truncated&&<p className="mt-2 text-xs text-muted">Text shortened to 6,000 characters.</p>}
  </article>;
}
