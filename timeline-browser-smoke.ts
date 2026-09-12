// Standalone local DOM integration smoke for the full-page Timeline view.
// Uses already-installed happy-dom through HAPPY_DOM_PATH; no install or real transcripts.
import {appendFile,mkdir,mkdtemp,rm,utimes,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {startServer} from "./server";

const modulePath=process.env.HAPPY_DOM_PATH;
if(!modulePath)throw new Error("Set HAPPY_DOM_PATH to an existing happy-dom lib/index.js for this optional DOM test");
const {Window}=await import(modulePath);
const temporary=await mkdtemp(join(tmpdir(),"jsonl-timeline-web-smoke-"));
let backend:Awaited<ReturnType<typeof startServer>>|undefined,window:any;
function assert(value:unknown,message:string):asserts value{if(!value)throw new Error(message);}
async function until(check:()=>boolean,label:string){const deadline=Date.now()+6000;while(!check()){if(Date.now()>deadline)throw new Error(`DOM timeout: ${label}\n${window?.document?.body?.textContent}`);await Bun.sleep(25);}}
const line=(value:unknown)=>JSON.stringify(value)+"\n";

try{
  const alphaDirectory=join(temporary,"-work-alpha"),extraDirectory=join(temporary,"-work-alpha-extra"),betaDirectory=join(temporary,"-work-beta");
  await Promise.all([mkdir(alphaDirectory),mkdir(extraDirectory),mkdir(betaDirectory)]);
  const subagents=join(alphaDirectory,"subagents");await mkdir(subagents);
  const alpha=join(alphaDirectory,"alpha111.jsonl"),peer=join(alphaDirectory,"alpha222.jsonl"),subagent=join(subagents,"agent-sub111.jsonl"),extra=join(extraDirectory,"extra333.jsonl"),beta=join(betaDirectory,"beta444.jsonl");
  const unsafeMultiline="Cozy first line\nCozy second line <img src=x onerror=alert(1)>\nCozy third line";
  const originalAlpha=[
    {type:"user",timestamp:"2026-09-11T10:00:00Z",message:{role:"user",content:unsafeMultiline}},
    {type:"assistant",timestamp:"2026-09-11T10:04:00Z",message:{role:"assistant",content:"ALPHA LATEST event"}},
  ].map(line).join("");
  await writeFile(alpha,originalAlpha);
  await writeFile(peer,line({type:"assistant",timestamp:"2026-09-11T10:03:00Z",message:{role:"assistant",content:"Needle peer event"}}));
  await writeFile(subagent,[
    {type:"assistant",timestamp:"2026-09-11T10:05:00Z",message:{role:"assistant",content:"Subagent output event"}},
    {type:"assistant",timestamp:"2026-09-11T10:05:01Z",message:{role:"assistant",content:[{type:"tool_use",name:"Read",input:{path:"fixture.txt"}}]}},
  ].map(line).join(""));
  await writeFile(extra,Array.from({length:22},(_,index)=>line({type:"assistant",timestamp:new Date(Date.UTC(2026,8,11,9,index)).toISOString(),message:{role:"assistant",content:index===21?"EXACT FILTER MUST EXCLUDE ME":`Extra event ${index}`}})).join(""));
  await writeFile(beta,line({type:"assistant",timestamp:"2026-09-11T10:02:00Z",message:{role:"assistant",content:"Beta event"}}));

  backend=await startServer({root:temporary,port:0,namesFile:join(temporary,"names.json")});
  const html=await(await fetch(backend.url)).text(),css=await(await fetch(`${backend.url}/style.css`)).text();
  assert(html.includes("JSONL Liveness"),"HTML not served");
  assert(css.includes("#app-shell:has(#workspace[data-view=timeline]){height:auto;min-height:100dvh;display:block}")&&!css.includes("#app-shell:has(#workspace[data-view=timeline]){max-width:none")&&css.includes("prefers-reduced-motion:reduce")&&css.includes("--row-bg:var(--surface)")&&css.includes("--row-bg:var(--panel)")&&css.includes("background-color:var(--row-bg)")&&!css.includes("height:18rem")&&!css.includes(".timeline-grid .timeline-event-scroll"),"Timeline shared shell, zebra, fading, reduced-motion, or natural-height CSS absent");
  window=new Window({url:`${backend.url}/?view=timeline`});window.AbortController=AbortController;window.AbortSignal=AbortSignal;
  let snapshotRequests=0,timelineRequests=0,timelineInFlight=0,fingerprintRequests=0,detailRequests=0;
  let failNextTimeline=false,delayNextSnapshot=false,releaseSnapshot:(()=>void)|undefined;
  const timelineURLs:string[]=[];
  window.fetch=async(input:string|URL|Request,init:RequestInit={})=>{
    const url=typeof input==="string"?input:input instanceof URL?input.href:input.url,parsed=new URL(url);
    if(parsed.pathname==="/api/snapshot"){snapshotRequests++;if(delayNextSnapshot){delayNextSnapshot=false;await new Promise<void>(resolve=>{releaseSnapshot=resolve;});}}
    if(parsed.pathname==="/api/timeline"){
      timelineRequests++;timelineURLs.push(url);
      if(failNextTimeline){failNextTimeline=false;return new Response("synthetic timeline failure",{status:503});}
      timelineInFlight++;try{return await fetch(input as any,init);}finally{timelineInFlight--;}
    }
    if(parsed.pathname==="/api/session/fingerprint")fingerprintRequests++;
    if(parsed.pathname==="/api/session/detail")detailRequests++;
    return fetch(input as any,init);
  };
  window.document.write(html.replace(/<script[\s\S]*?<\/script>/g,""));
  const bundle=await Bun.build({entrypoints:[join(import.meta.dir,"web/main.ts")],target:"browser",format:"iife"});
  assert(bundle.success,`Browser build failed: ${bundle.logs.join("\n")}`);
  const execute=new Function("window","document","location","history","localStorage","fetch","AbortController","AbortSignal","setTimeout","clearTimeout",await bundle.outputs[0].text());
  execute(window,window.document,window.location,window.history,window.localStorage,window.fetch,AbortController,AbortSignal,window.setTimeout.bind(window),window.clearTimeout.bind(window));

  const $=(id:string)=>window.document.getElementById(id);
  const setInput=async(id:string,value:string)=>{const element=$(id);Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value")!.set!.call(element,value);element.dispatchEvent(new window.Event("input",{bubbles:true}));await Bun.sleep(0);};
  const setSelect=async(id:string,value:string)=>{const element=$(id);Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype,"value")!.set!.call(element,value);element.dispatchEvent(new window.Event("change",{bubbles:true}));await Bun.sleep(0);};
  const toggle=async(id:string)=>{$(id).click();await Bun.sleep(0);};
  const rows=()=>Array.from($("timeline-rows")?.querySelectorAll("tr")??[]) as any[];
  const ids=()=>rows().map(row=>row.dataset.eventId),texts=()=>rows().map(row=>row.textContent as string),times=()=>rows().map(row=>row.querySelector("time")?.dateTime??"");
  const refresh=async(label:string)=>{await until(()=>!!$("timeline-refresh")&&!$("timeline-refresh").disabled,`${label}: ready`);const before=timelineRequests;$("timeline-refresh").click();await until(()=>timelineRequests>before,`${label}: request`);await Bun.sleep(0);await until(()=>timelineInFlight===0&&!$("timeline-refresh").disabled&&$("timeline-live").textContent!=="Updating…",`${label}: settled`);};

  await until(()=>$("workspace")?.dataset.view==="timeline"&&rows().length===28,"initial route and seed");
  assert(new URL(window.location.href).searchParams.get("view")==="timeline"&&$("view-timeline").getAttribute("aria-pressed")==="true","Initial Timeline route/nav lost");
  assert($("timeline-limit").value==="50"&&$("timeline-direction").value==="top"&&
    $("timeline-show-human").checked&&$("timeline-show-output").checked&&$("timeline-show-tools").checked&&
    $("timeline-show-main").checked&&$("timeline-show-subagents").checked&&!$("timeline-order"),"New Timeline control defaults absent");
  assert(new URL(timelineURLs[0]).searchParams.get("limit")==="50","Initial request did not use limit=50");
  assert($("app-shell")&&$("workspace").className.includes("xl:grid-cols-1"),"Timeline workspace is not single-page");
  assert($("timeline-scroll").className==="min-w-0"&&!$("timeline-scroll").className.includes("overflow"),"Full-table Timeline wrapper became scrollable");
  assert(rows().every(row=>row.querySelector(".timeline-event")&&row.querySelector(".timeline-event pre")),"Rows lack natural-height event content");
  assert(!$("live-dialog")&&window.document.querySelectorAll("dialog").length===0&&$("sidebar-scroll").closest("[hidden]"),"Timeline exposed popup/sidebar");
  assert($("timeline-table").querySelectorAll("a,button").length===0,"Timeline table contains session links/buttons");
  assert(texts().filter(text=>text.includes("alpha111")).length===2,"Multiple same-session events missing");
  assert(times()[0]==="2026-09-11T10:05:01.000Z"&&times().at(-1)==="2026-09-11T09:00:00.000Z","Initial default seed is not newest-first");
  const multiline=rows().find(row=>row.textContent.includes("Cozy first line"))?.querySelector("pre");
  assert(multiline?.textContent===unsafeMultiline&&multiline.textContent.split("\n").length===3&&$("timeline-rows").querySelectorAll("img,script").length===0,"Multiline/HTML inert rendering failed");
  assert($("timeline-limits").textContent.includes("Partial records wait for a newline")&&fingerprintRequests===0&&detailRequests===0,"Timeline boundary/no-detail contract failed");

  $("home").click();await until(()=>$("workspace").dataset.view==="table","Home to Table");assert(!new URL(window.location.href).searchParams.has("view"),"Home retained view");
  window.history.back();await until(()=>$("workspace").dataset.view==="timeline","Back to Timeline");window.history.forward();await until(()=>$("workspace").dataset.view==="table","Forward to Table");
  $("view-timeline").click();await until(()=>$("workspace").dataset.view==="timeline"&&rows().length===28,"Timeline nav");const timelineDetailBaseline=detailRequests;

  await setSelect("timeline-project","/work/alpha");await until(()=>rows().length===5&&texts().every(text=>text.includes("/work/alpha")),"exact project filter");
  assert(!$("timeline-rows").textContent.includes("EXACT FILTER MUST EXCLUDE ME"),"Project prefix leaked");
  const filteredURL=new URL(timelineURLs.at(-1)!);assert(filteredURL.searchParams.get("project")==="/work/alpha"&&filteredURL.searchParams.get("limit")==="50","Exact project/limit request failed");
  const beforeCheckboxFilters=timelineRequests;
  await toggle("timeline-show-main");await until(()=>rows().length===2&&texts().some(text=>text.includes("Subagent output event")),"subagent source filter");
  await toggle("timeline-show-tools");await until(()=>rows().length===1&&texts()[0].includes("Subagent output event"),"output event filter");
  await toggle("timeline-show-output");await until(()=>rows().length===0&&!!$("timeline-empty"),"empty event selection");
  await toggle("timeline-show-tools");await until(()=>rows().length===1&&texts()[0].includes("Tool: Read"),"tools event filter");
  await toggle("timeline-show-subagents");await until(()=>rows().length===0&&!!$("timeline-empty"),"empty source selection");
  await toggle("timeline-show-main");await until(()=>rows().length===1&&texts()[0].includes("Cozy first line"),"human event filter");
  await toggle("timeline-show-output");await until(()=>rows().length===3,"all main events");
  await toggle("timeline-show-subagents");await until(()=>rows().length===5,"all alpha sources");
  assert(timelineRequests===beforeCheckboxFilters,"Checkbox filters reloaded the feed instead of filtering locally");
  await setInput("timeline-search","nEeDlE");await until(()=>rows().length===1&&rows()[0].textContent.includes("Needle peer event"),"search");await setInput("timeline-search","");await until(()=>rows().length===5,"clear search");
  await toggle("timeline-show-subagents");await until(()=>rows().length===3,"main sessions restored");
  assert(JSON.stringify(times())===JSON.stringify(["2026-09-11T10:04:00.000Z","2026-09-11T10:03:00.000Z","2026-09-11T10:00:00.000Z"]),"Default top order wrong");
  await setSelect("timeline-direction","bottom");await until(()=>times()[0]==="2026-09-11T10:00:00.000Z","bottom direction");assert(times().at(-1)==="2026-09-11T10:04:00.000Z","Bottom order wrong");
  await toggle("timeline-show-subagents");await until(()=>rows().length===5,"all alpha sources restored");

  await setSelect("timeline-project","");await until(()=>rows().length===28,"all projects");
  await setSelect("timeline-limit","20");await until(()=>rows().length===20,"limit 20");assert(new URL(window.location.href).searchParams.get("limit")==="20"&&new URL(timelineURLs.at(-1)!).searchParams.get("limit")==="20","limit=20 not stored/requested");
  await setSelect("timeline-limit","100");await until(()=>rows().length===28,"limit 100");assert(new URL(window.location.href).searchParams.get("limit")==="100","limit=100 not stored");
  await setSelect("timeline-limit","50");await until(()=>rows().length===28,"limit 50");await toggle("timeline-show-subagents");await setSelect("timeline-project","/work/alpha");await until(()=>rows().length===3,"alpha restored");

  const ageSnapshots=snapshotRequests,ageTimelines=timelineRequests;await until(()=>snapshotRequests>ageSnapshots,"age tick");await Bun.sleep(100);assert(timelineRequests===ageTimelines,"Age-only tick reloaded feed");
  const touchIDs=ids(),touchTimes=times();await utimes(alpha,new Date(),new Date(Date.now()+1000));await backend.service.refresh();await refresh("touch");assert(JSON.stringify(ids())===JSON.stringify(touchIDs)&&JSON.stringify(times())===JSON.stringify(touchTimes),"Touch changed IDs/order");

  const live=JSON.stringify({type:"assistant",timestamp:"2026-09-11T10:06:00Z",message:{role:"assistant",content:"LIVE APPEND\nsecond live line"}});
  await appendFile(alpha,live);await backend.service.refresh();await refresh("partial");assert(!$("timeline-rows").textContent.includes("LIVE APPEND")&&new Set(ids()).size===3,"Partial appeared/duplicated");
  $("timeline-follow").click();await until(()=>$("timeline-follow").getAttribute("aria-pressed")==="false","manual follow toggle");
  await appendFile(alpha,"\n");await backend.service.refresh();const liveSnapshots=snapshotRequests,liveTimelines=timelineRequests;
  await until(()=>snapshotRequests>liveSnapshots,"automatic append snapshot");await until(()=>timelineRequests>liveTimelines,"automatic append feed");await until(()=>texts().filter(text=>text.includes("LIVE APPEND")).length===1,"one live append");
  assert(new Set(ids()).size===4&&times().at(-1)==="2026-09-11T10:06:00.000Z","Append not at bottom/duplicate-free");const liveRow=rows().find(row=>row.textContent.includes("LIVE APPEND"));assert(liveRow?.dataset.new==="true"&&liveRow.textContent.includes("· New"),"New highlight absent");
  await until(()=>$("timeline-new")?.textContent.includes("1 new entry"),"new count");
  await setSelect("timeline-direction","top");await until(()=>times()[0]==="2026-09-11T10:06:00.000Z","top shows new event first");assert(times().at(-1)==="2026-09-11T10:00:00.000Z"&&$("timeline-follow").getAttribute("aria-pressed")==="true"&&!$("timeline-new"),"Top direction order/follow reset after append wrong");await setSelect("timeline-direction","bottom");
  await until(()=>!rows().find(row=>row.textContent.includes("LIVE APPEND"))?.dataset.new,"highlight expiry");

  await writeFile(alpha,originalAlpha);await backend.service.refresh();const rewriteSnapshots=snapshotRequests,rewriteTimelines=timelineRequests;await until(()=>snapshotRequests>rewriteSnapshots,"rewrite snapshot");await until(()=>timelineRequests>rewriteTimelines,"rewrite feed");assert($("timeline-rows").textContent.includes("LIVE APPEND"),"Automatic update replaced accumulated feed");
  // Isolate the delayed manual request from automatic polling, and do not click
  // a disabled Refresh while the preceding automatic feed is still resolving.
  $("timeline-pause").click();
  await until(()=>$("timeline-live").textContent==="Paused"&&!$("timeline-refresh").disabled&&!$("refresh").disabled,"reset barrier paused/idle");
  delayNextSnapshot=true;const resetRequest=timelineRequests;$("timeline-refresh").click();await until(()=>!!releaseSnapshot&&rows().length===0,"Refresh clears before backend");releaseSnapshot!();releaseSnapshot=undefined;await until(()=>timelineRequests>resetRequest,"reset request");await until(()=>timelineInFlight===0&&!$("timeline-refresh").disabled&&rows().length===3,"reset batch");assert(!$("timeline-rows").textContent.includes("LIVE APPEND"),"Refresh retained stale accumulation");
  $("timeline-pause").click();await until(()=>$("connection").textContent.includes("Live")&&!$("timeline-refresh").disabled,"resume after reset barrier");

  $("timeline-pause").click();await until(()=>$("timeline-live").textContent==="Paused"&&$("connection").textContent==="Paused","pause");await Bun.sleep(100);const pausedSnapshots=snapshotRequests,pausedTimelines=timelineRequests;await Bun.sleep(2200);assert(snapshotRequests===pausedSnapshots&&timelineRequests===pausedTimelines,"Pause polled");
  await refresh("paused manual Refresh");assert($("timeline-live").textContent==="Paused"&&rows().length===3,"Paused Refresh failed");const afterPaused=snapshotRequests;await Bun.sleep(2200);assert(snapshotRequests===afterPaused,"Paused Refresh restarted polling");$("timeline-pause").click();await until(()=>$("connection").textContent.includes("Live")&&snapshotRequests>afterPaused,"resume");

  failNextTimeline=true;await refresh("synthetic failure");await until(()=>$("timeline-error")?.textContent.includes("Backend HTTP 503"),"inline failure");assert(rows().length===0,"Failed Refresh retained feed");await refresh("retry");await until(()=>!$("timeline-error")&&rows().length===3,"retry recovery");
  assert(fingerprintRequests===0&&detailRequests===timelineDetailBaseline,"Timeline-only activity fingerprinted/read detail");
  console.log(`Timeline DOM + HTTP PASS: route/history, shared-shell natural-height rows, default-top/bottom/top-new-first, zebra/fade/reduced-motion CSS, document follow-off, non-scrolling table wrapper, 20/50/100 limits, inert multiline, exact filter/search, age cache, touch stability, automatic append/highlight/no duplicates, reset, pause/Refresh/resume, failure-empty/retry; requests snapshot=${snapshotRequests} timeline=${timelineRequests} fingerprint=${fingerprintRequests} detail=${detailRequests}`);
}finally{window?.dispatchEvent(new window.Event("pagehide"));await window?.happyDOM.abort();window?.close();backend?.stop();await rm(temporary,{recursive:true,force:true});}
