import { test, expect } from "bun:test";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ActivityEvent } from "./web/components/ActivityEvent";
import { isSnapshot } from "./web/model";
import { SessionTiming } from "./web/components/SessionTiming";

function luminance(hex:string) {
  const channels=hex.match(/\w\w/g)!.map(value=>parseInt(value,16)/255).map(value=>value<=0.04045?value/12.92:((value+0.055)/1.055)**2.4);
  return channels[0]*0.2126+channels[1]*0.7152+channels[2]*0.0722;
}
function contrast(a:string,b:string) {const values=[luminance(a),luminance(b)].sort((a,b)=>b-a);return (values[0]+0.05)/(values[1]+0.05);}
test("all three theme palettes keep text and accent controls legible",async()=>{
  const css=await readFile(new URL("./web/theme.css",import.meta.url),"utf8");
  for(const selector of [":root",":root[data-theme=vangogh]",":root[data-theme=paper]"]) {
    const block=css.slice(css.indexOf(selector)).split("}")[0];
    const tokens=Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[\da-f]{6})/g)].map(match=>[match[1],match[2]]));
    for(const surface of ["canvas","surface","panel","code","selected"])
      for(const color of ["ink","muted","accent"])
        expect(contrast(tokens[color].slice(1),tokens[surface].slice(1))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(tokens["accent-ink"].slice(1),tokens.accent.slice(1))).toBeGreaterThanOrEqual(4.5);
  }
});
test("components can render independently and escape transcript content",()=>{
  const html=renderToStaticMarkup(createElement(ActivityEvent,{event:{id:"0:0",kind:"message",role:"user",title:"User",timestamp:null,text:'<img src=x onerror="alert(1)">',truncated:false}}));
  expect(html).toContain("&lt;img");expect(html).not.toContain("<img");
  const timing=renderToStaticMarkup(createElement(SessionTiming,{updated:"2026-09-11T10:00:00Z",loading:false}));
  expect(timing).toContain("Not recorded in this tail");expect(timing).toContain("Not found in first 64 KiB");
});

test("popup tools can default open without nested output clipping",()=>{
  const html=renderToStaticMarkup(createElement(ActivityEvent,{event:{id:"1:0",kind:"tool-result",role:"user",title:"Tool result",timestamp:null,text:"Latest tool output",truncated:false},defaultExpanded:true,unbounded:true}));
  expect(html).toContain('open=""');
  expect(html).not.toContain("max-h-80");
});

test("host client accepts older snapshots and validates optional revision tokens",()=>{
  const file={path:"/fixture/demo.jsonl",project:"demo",tier:"session",class:"hot",age:0,size:3};
  const snapshot={scannedAt:new Date().toISOString(),scanMs:0,counts:{hot:1,warm:0,cool:0,dead:0},errors:[],files:[file]};
  expect(isSnapshot(snapshot)).toBe(true);
  expect(isSnapshot({...snapshot,files:[{...file,revision:"stat-token"}]})).toBe(true);
  expect(isSnapshot({...snapshot,files:[{...file,revision:123}]})).toBe(false);
});


test("message ordering ignores touches and unknown presence is never shown closed",async()=>{
  const {latestMessages,openLabel}=await import("./session-status");
  const older={path:"a",message:{timestamp:"2026-09-01T00:00:00Z"}};
  const newer={path:"b",message:{timestamp:"2026-09-02T00:00:00Z"}};
  expect(latestMessages([{path:"unknown"},older,newer]).map(file=>file.path)).toEqual(["b","a","unknown"]);
  expect(openLabel({})).toBe("Open: unknown");
  expect(openLabel({presence:{state:"open",pids:[42]}})).toBe("Open · PID 42");
});

test("timeline response validation rejects malformed event timestamps and metadata", async () => {
  const {isTimelineSnapshot} = await import("./web/timeline-model");
  const data = {scannedAt:new Date().toISOString(),filesConsidered:1,totalFiles:1,limitedSessions:false,tailBytes:65536,maxSessions:50,limit:200,omittedRows:0,readErrors:0,reads:1,
    rows:[{id:"a",path:"a.jsonl",sessionId:"a",project:"/demo",name:null,tier:"session",timestamp:null,kind:"message",role:"user",title:"user",text:"line 1\nline 2",truncated:false}]};
  expect(isTimelineSnapshot(data)).toBe(true);
  expect(isTimelineSnapshot({...data,rows:[{...data.rows[0],timestamp:"invalid"}]})).toBe(false);
  expect(isTimelineSnapshot({...data,rows:[{...data.rows[0],kind:"raw-thinking"}]})).toBe(false);
  expect(isTimelineSnapshot({...data,rows:[{...data.rows[0],sessionId:42}]})).toBe(false);
  expect(isTimelineSnapshot({...data,tailBytes:-1})).toBe(false);
});

test("timeline stream appends unseen arrivals at bottom, bounds rows and resets on refresh",async()=>{
  const {appendTimelineRows}=await import("./web/timeline-model");
  const row=(id:string,timestamp:string)=>({id,path:"a.jsonl",sessionId:"a",project:"/demo",name:null,tier:"session",timestamp,kind:"message" as const,role:"user",title:"user",text:id,truncated:false});
  const a=row("a","2026-09-12T01:00:00Z"),b=row("b","2026-09-12T02:00:00Z"),c=row("c","2026-09-12T00:00:00Z");
  expect(appendTimelineRows([], [b,a], 50).map(r=>r.id)).toEqual(["a","b"]);
  expect(appendTimelineRows([a,b], [b,a,c], 50).map(r=>r.id)).toEqual(["a","b","c"]);
  expect(appendTimelineRows([a,b], [b,a,c], 2).map(r=>r.id)).toEqual(["b","c"]);
  expect(appendTimelineRows([], [b,a,c], 2).map(r=>r.id)).toEqual(["a","b"]);
  expect(appendTimelineRows([a,b], [{...b,name:"Alias"},a], 50)).toEqual([a,{...b,name:"Alias"}]);
});

test("timeline checkbox filters distinguish people, outputs, tools and workflow tiers",async()=>{
  const {matchesTimelineCheckboxes,timelineEventGroup,timelineSourceGroup}=await import("./web/timeline-model");
  const row=(kind:"message"|"tool-use"|"event",role:string,tier:string)=>({id:`${kind}:${role}:${tier}`,path:"a.jsonl",sessionId:"a",project:"/demo",name:null,tier,timestamp:null,kind,role,title:role,text:"text",truncated:false});
  const human=row("message","user","session"), output=row("message","assistant","session"), tool=row("tool-use","assistant","subagent"), journal=row("event","system","workflow-journal");
  expect(timelineEventGroup(human)).toBe("human");
  expect(timelineEventGroup(output)).toBe("output");
  expect(timelineEventGroup(tool)).toBe("tools");
  expect(timelineSourceGroup(human)).toBe("main");
  expect(timelineSourceGroup(tool)).toBe("subagents");
  expect(timelineSourceGroup(journal)).toBe("subagents");
  expect(matchesTimelineCheckboxes(human,new Set(["human"]),new Set(["main"]))).toBe(true);
  expect(matchesTimelineCheckboxes(human,new Set(["output"]),new Set(["main","subagents"]))).toBe(false);
  expect(matchesTimelineCheckboxes(tool,new Set(["tools"]),new Set(["subagents"]))).toBe(true);
  expect(matchesTimelineCheckboxes(journal,new Set(["tools"]),new Set(["main"]))).toBe(false);
  expect(matchesTimelineCheckboxes(output,new Set(["human","output"]),new Set(["main","subagents"]))).toBe(true);
  expect(matchesTimelineCheckboxes(output,new Set(),new Set(["main"]))).toBe(false);
});

test("timeline zebra rows and reduced-motion-safe arrival fade use theme tokens",async()=>{
  const css=await readFile(new URL("./web/theme.css",import.meta.url),"utf8");
  expect(css).toContain("tbody tr:nth-child(even) {--row-bg:var(--panel);}");
  expect(css).toContain("tbody tr {--row-bg:var(--surface);background-color:var(--row-bg);}");
  expect(css).toContain("0%,100% {background-color:var(--row-bg);}");
  expect(css).toContain("25%,55% {background-color:var(--selected);}");
  expect(css).toContain("@keyframes arrival-badge {0%,100% {opacity:0;} 25%,55% {opacity:1;}}");
  expect(css).toContain("prefers-reduced-motion:reduce");
  expect(css).toContain("animation:none;background:var(--selected)");
});

test("home arrival cue compares messages only, never file touches or aliases",async()=>{
  const {messageRevision}=await import("./web/model");
  const message={role:"assistant",timestamp:"2026-09-12T01:00:00Z",text:"Hello",truncated:false,lastEventAt:null};
  const file={message,mtimeMs:1,name:"Before"};
  const touched={...file,mtimeMs:2000,name:"After"};
  expect(messageRevision(file)).toBe(messageRevision(touched));
  expect(messageRevision(file)).not.toBe(messageRevision({message:{...message,text:"New text"}}));
  expect(messageRevision(file)).not.toBe(messageRevision({message:{...message,timestamp:"2026-09-12T01:00:01Z"}}));
  expect(messageRevision({})).toBeUndefined();
});

test("timeline keeps the shared shell width and natural-height rows without nested clipping",async()=>{
  const css=await readFile(new URL("./web/theme.css",import.meta.url),"utf8");
  const shell=css.match(/#app-shell:has\(#workspace\[data-view=timeline\]\)\s*\{([^}]+)\}/)![1];
  expect(shell).toContain("height:auto");
  expect(shell).toContain("display:block");
  expect(shell).not.toContain("max-width");
  expect(css).not.toMatch(/\.timeline-(?:event|event-scroll|meta)\s*\{[^}]*(?:max-height|height:18rem|overflow:auto)/);
});

test("session list leads with the decoded project and keeps the complete ID visible",async()=>{
  const source=await readFile(new URL("./web/components/SessionList.tsx",import.meta.url),"utf8");
  expect(source).toContain(">Session ID</th>");
  expect(source).toContain('{file.name||fullID(file)}');
  expect(source).toContain("sessionIdentity(file).sessionId");
  expect(source).toContain("sessionIdentity(file).agentId");
  expect(source).toContain("title={file.project}");
  expect(source).not.toContain("fullID(file).slice(0,18)");
});
