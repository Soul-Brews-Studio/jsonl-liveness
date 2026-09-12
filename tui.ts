import { updateTuiFeed } from "./tui-feed";
import { renderTuiTimeline, matchingTimelineRows } from "./tui-timeline";
import type { TimelineRow } from "./timeline";
import { latestMessages, openLabel } from "./session-status";
import { renderTuiDetail } from "./tui-detail";
import type { SessionDetail } from "./details";
import { emitKeypressEvents } from "node:readline";
import { ageLabel, shortProject, sizeLabel } from "./display";
import { type Thresholds } from "./liveness";
import { sessionId, type Names } from "./names";
import { localSource, snapshotNames, type SessionSource, type Snapshot } from "./source";

type File = Snapshot["files"][number];
const clean = (value: string) => value.replace(/[\x00-\x1f\x7f-\x9f]/g, "?");
export function matchingFiles(snapshot: Snapshot, names: Names, all: boolean, query: string): File[] {
  return latestMessages(snapshot.files).filter(file => (all || file.class !== "dead") &&
    `${sessionId(file.path)} ${names[file.path] ?? ""} ${file.project} ${file.tier}`.toLowerCase().includes(query.toLowerCase()));
}
export function renderTui(snapshot: Snapshot, names: Names, files: File[], selected: number, width: number, height: number, footer: string): string {
  const limit = Math.max(1, height - 14);
  const offset = Math.max(0, selected - limit + 1);
  const lines = [
    `JSONL LIVENESS · ${snapshot.files.length} files · ${snapshot.scanMs}ms scan`,
    Object.entries(snapshot.counts).map(([state, count]) => `${count} ${state}`).join(" · "),
    "",
    "  SESSION ID      NAME / PROJECT                OPEN       MSG AGE  FILE AGE    SIZE",
  ];
  let previous = "";
  for (let i = offset; i < Math.min(files.length, offset + limit); i++) {
    const file = files[i];
    const group = file.class === previous ? " " : file.class.toUpperCase();
    previous = file.class;
    const rawId = sessionId(file.path);
    const id = rawId.startsWith("agent-") ? `a:${rawId.slice(6, 14)}` : rawId.slice(0, 12);
    const label = names[file.path] || shortProject(file.project);
    const messageAt=Date.parse(file.message?.timestamp??"");
    const messageAge=Number.isFinite(messageAt)?ageLabel(Math.max(0,Date.parse(snapshot.scannedAt)-messageAt)):"?";
    const open=file.presence?.state==="open"?"yes":"unknown";
    const row = `${i === selected ? ">" : " "} ${id.padEnd(14)}  ${clean(label).slice(0, 28).padEnd(28)}  ${open.padEnd(8)} ${messageAge.padStart(7)} ${ageLabel(file.age).padStart(9)} ${sizeLabel(file.size).padStart(7)}  ${group}`;
    lines.push(row);
  }
  if (!files.length) lines.push("No matching files. Press a to include dead files, or / to change search.");
  const file = files[selected];
  lines.push("", `Showing ${files.length ? offset + 1 : 0}–${Math.min(files.length, offset + limit)} of ${files.length} matching files`);
  if (file) {
    lines.push(`${names[file.path] || "Unnamed"} · ${sessionId(file.path)} · ${file.tier} · ${file.class}`);
    lines.push(`Message ${file.message?.timestamp?new Date(file.message.timestamp).toLocaleString():"not found in tail"} · ${openLabel(file)}`);
    lines.push(`File touched ${file.modifiedAt?new Date(file.modifiedAt).toLocaleString():new Date(Date.parse(snapshot.scannedAt)-file.age).toLocaleString()} · mtimeMs ${file.mtimeMs??"unknown"}`);
    lines.push(file.path);
  } else lines.push("", "", "");
  lines.push("File freshness may be heartbeat, not a new message. Open does not mean working.");
  lines.push(footer);
  return lines.slice(0, Math.max(1, height - 1)).map(line => Array.from(clean(line)).slice(0, Math.max(1, width - 1)).join("")).join("\n");
}

export async function watchTui(root: string, thresholds: Thresholds, source: SessionSource = localSource(root, thresholds)): Promise<void> {
  let snapshot = await source.read();
  let names = snapshotNames(snapshot);
  let selectedPath = "", query = "", all = true, paused = false, stopped = false, scanning = false;
  let edit: { kind: "name" | "search"; text: string; path: string } | undefined;
  let refreshRequested=false;
  let saving = false, message = "", timer: ReturnType<typeof setTimeout> | undefined;
  let detailPath="",detailData:SessionDetail|undefined,detailRevision="",detailLoading=false,detailError="",detailEpoch=0;
  let detailOffset=0,following=true,newestFirst=false;
  let timelineMode=false,timelineRows:TimelineRow[]=[],timelineSelected="",timelineFollowing=true;
  let timelineSeen=new Set<string>();
  let timelineLoading=false,timelineError="",timelineEpoch=0,timelineLimit=50;
  let timelineInFlight=false,timelineReload=false,timelineSignature="";
  let timelineProjects:Set<string>|null=null,observedProjects=new Set<string>();
  let projectPicker:{items:string[];selected:Set<string>|null;index:number}|undefined;
  const eventGroups=new Set(["human","output","tools"]),sourceGroups=new Set(["main","subagents"]);
  const timelineHelp="t sessions · Enter detail · ↑↓ move · 1 human 2 AI 3 tools · 4 main 5 subagents · g projects · / find · p pause · f follow · r refresh · l limit · q quit";
  const timelineVisible=()=>matchingTimelineRows(timelineRows,eventGroups,sourceGroups,"",query)
    .filter(row=>timelineProjects===null||timelineProjects.has(row.project));
  function resetTimeline(clearProjects=false){
    timelineEpoch++;timelineSignature="";timelineRows=[];timelineSeen.clear();timelineSelected="";timelineError="";
    if(clearProjects)observedProjects.clear();
  }
  async function loadTimeline(){
    if(stopped||!timelineMode)return;
    if(timelineInFlight){timelineReload=true;return;}
    if(timelineProjects?.size===0){timelineRows=[];draw();return;}
    const eligible=latestMessages(snapshot.files).filter(file=>timelineProjects===null||timelineProjects.has(file.project)).slice(0,50);
    const signature=JSON.stringify([timelineLimit,timelineProjects===null?null:[...timelineProjects].sort(),
      eligible.map(file=>[file.path,file.revision,file.mtimeMs,file.size,file.name,file.project])]);
    if(signature===timelineSignature)return;
    const epoch=++timelineEpoch;timelineLoading=true;timelineInFlight=true;
    try{
      const data=await source.timeline(timelineProjects===null?undefined:[...timelineProjects],200);
      if(stopped||epoch!==timelineEpoch||!timelineMode)return;
      for(const row of data.rows)observedProjects.add(row.project);
      const next=updateTuiFeed(timelineRows,data.rows,timelineSeen,timelineLimit);
      timelineRows=next.rows;timelineSeen=next.seen;timelineSignature=signature;
      timelineError=data.readErrors?`${data.readErrors} session read errors`:"";
      if(timelineFollowing)timelineSelected="";
    }catch(error){if(epoch===timelineEpoch)timelineError=`Timeline unavailable: ${error}`;}
    finally{
      timelineLoading=false;timelineInFlight=false;draw();
      if(timelineReload){timelineReload=false;void loadTimeline();}
    }
  }
  const help = "t timeline · Enter detail · ↑↓/jk move · n name · / find · a all/touched · p pause · q quit";
  const files = () => matchingFiles(snapshot, names, all, query);
  const index = (rows: File[]) => Math.max(0, rows.findIndex(file => file.path === selectedPath));
  let fail: (error: unknown) => void = error => { throw error; };
  let cleanup = () => {};
  function draw() {
    if (stopped) return;
    try {
    const rows = files();
    const selected = index(rows);
    selectedPath = rows[selected]?.path ?? "";
    const footer = edit ? `${edit.kind === "name" ? "Name (empty clears)" : "Search"}: ${edit.text}█ · Enter saves · Esc cancels`
      : `${paused ? "PAUSED · " : ""}${message || help}${snapshot.errors.length ? ` · ${snapshot.errors.length} read errors` : ""}`;
    const width=process.stdout.columns||110,height=process.stdout.rows||30;
    let output:string;
    if(detailPath){
      const frame=renderTuiDetail({path:detailPath,file:snapshot.files.find(file=>file.path===detailPath),name:names[detailPath],data:detailData,error:detailError||message,loading:detailLoading,paused,following,newestFirst,offset:detailOffset,width,height});
      detailOffset=frame.offset;output=frame.text;
    }else if(timelineMode){
      const events=timelineVisible();
      const selectedEvent=timelineFollowing?0:Math.max(0,events.findIndex(row=>row.id===timelineSelected));
      timelineSelected=events[selectedEvent]?.id??"";
      output=renderTuiTimeline({rows:events,selected:selectedEvent,width,height,footer:edit?footer:timelineHelp,
        paused,following:timelineFollowing,eventGroups,sourceGroups,
        project:timelineProjects===null?"All":timelineProjects.size===0?"None":`${timelineProjects.size} selected`,
        limit:timelineLimit,loading:timelineLoading,error:timelineError||message});
      if(projectPicker){
        const start=Math.max(0,projectPicker.index-Math.max(1,height-7)+1);
        const choices=projectPicker.items.slice(start,start+Math.max(1,height-7)).map((project,i)=>
          `${start+i===projectPicker!.index?">":" "} [${projectPicker!.selected===null||projectPicker!.selected.has(project)?"x":" "}] ${project}`);
        output=["TIMELINE PROJECTS · seen in this feed",...choices,
          projectPicker.items.length?"":"No projects seen yet.",
          "Space toggle · a all (includes new) · n none · Enter apply · Esc cancel"]
          .slice(0,height-1).map(line=>Array.from(clean(line)).slice(0,width-1).join("")).join("\n");
      }
    }else output=renderTui(snapshot,names,rows,selected,width,height,footer);
    const palette="\x1b[0m\x1b[48;2;13;17;23m\x1b[38;2;230;237;243m";
    process.stdout.write(palette+"\x1b[H\x1b[2J"+output);
    } catch (error) { fail(error); }
  }
  async function loadDetail(force=false) {
    if(stopped||!detailPath||detailLoading)return;
    const path=detailPath,file=snapshot.files.find(file=>file.path===path);
    if(!file){detailError="Session no longer in snapshot · Esc back";return;}
    const revision=file.revision??`${file.size}:${file.mtimeMs??Date.parse(snapshot.scannedAt)-file.age}`;
    if(!force&&detailRevision===revision)return;
    const epoch=++detailEpoch;detailLoading=true;detailError="";
    try {
      const data=await source.detail(path);
      if(!stopped&&epoch===detailEpoch&&detailPath===path){detailData=data;detailRevision=revision;}
    }catch(error){if(epoch===detailEpoch)detailError=`Details unavailable: ${error}`;}
    finally{if(epoch===detailEpoch){detailLoading=false;draw();}}
  }
  async function refresh(force=false) {
    if (stopped) return;
    if(scanning){refreshRequested ||= force;return;}
    if(timer)clearTimeout(timer);
    const start = performance.now();
    scanning = true;
    try {
      if (!paused||force) {
        snapshot = await source.read();
        if (!edit && !saving) names = snapshotNames(snapshot);
        await loadDetail();
        if(timelineMode&&!detailPath)await loadTimeline();
      }
    } catch (error) { message = `Error: ${error}`; }
    finally {
      scanning = false;
      draw();
      if (!stopped) {
        const requested=refreshRequested;refreshRequested=false;
        timer=setTimeout(()=>refresh(requested),requested?0:Math.max(100,2000-(performance.now()-start)));
      }
    }
  }
  try {
  await new Promise<void>((done, reject) => {
    const wasRaw = Boolean(process.stdin.isRaw);
    cleanup = () => {
      if (stopped) return;
      stopped = true;
      if (timer) clearTimeout(timer);
      process.stdin.removeListener("keypress", onKeypress);
      process.stdout.removeListener("resize", draw);
      process.removeListener("SIGINT", stop);
      process.removeListener("SIGTERM", stop);
      // Cleanup remains best-effort even when a terminal device has disconnected.
      try { process.stdin.setRawMode(wasRaw); } catch {}
      process.stdin.pause();
      try { process.stdout.write("\x1b[0m\x1b[?25h\x1b[?1049l"); } catch {}
      process.stdin.removeListener("error", fail);
      process.stdout.removeListener("error", fail);
    };
    function stop() { cleanup(); done(); }
    fail = error => { cleanup(); reject(error); };
    async function keypress(text: string | undefined, key: { name?: string; ctrl?: boolean; meta?: boolean }) {
      if (key.ctrl && key.name === "c") { stop(); return; }
      if (saving) return;
      if(projectPicker){
        if(key.name==="escape")projectPicker=undefined;
        else if(key.name==="return"){
          timelineProjects=projectPicker.selected;projectPicker=undefined;resetTimeline();void loadTimeline();
        }else if(key.name==="a")projectPicker.selected=null;
        else if(key.name==="n")projectPicker.selected=new Set();
        else if(key.name==="space"){
          const project=projectPicker.items[projectPicker.index];
          if(project){
            const chosen=projectPicker.selected??new Set(projectPicker.items);
            if(chosen.has(project))chosen.delete(project);else chosen.add(project);
            projectPicker.selected=chosen;
          }
        }else if(["up","k","down","j"].includes(key.name??"")){
          projectPicker.index=Math.max(0,Math.min(projectPicker.items.length-1,projectPicker.index+(["up","k"].includes(key.name??"")?-1:1)));
        }
        draw();return;
      }
      if (edit) {
        if (key.name === "escape") edit = undefined;
        else if (key.name === "return") {
          const current = edit;
          if (current.kind === "search") { query = current.text; selectedPath = ""; edit = undefined; }
          else {
            saving = true;
            try { await source.rename(current.path, current.text); snapshot = await source.read(); names = snapshotNames(snapshot); edit = undefined; message = "Name saved · n rename · q quit"; }
            catch (error) { edit = undefined; message = `Name not saved: ${error}`; }
            finally { saving = false; }
          }
        } else if (key.name === "backspace") edit.text = Array.from(edit.text).slice(0, -1).join("");
        else if (key.ctrl && key.name === "u") edit.text = "";
        else if (text && !key.ctrl && !key.meta && !/[\x00-\x1f\x7f-\x9f]/.test(text)) edit.text = Array.from(edit.text + text).slice(0, 80).join("");
      } else {
        message = "";
        const rows = files(), current = index(rows);
        if (key.name === "q") { stop(); return; }
        if(detailPath){
          if(key.name==="escape"||key.name==="backspace"){detailPath="";detailData=undefined;detailEpoch++;detailLoading=false;}
          else if(key.name==="p")paused=!paused;
          else if(key.name==="f")following=!following;
          else if(key.name==="o"){newestFirst=!newestFirst;following=true;}
          else if(key.name==="end"){following=true;}
          else if(key.name==="home"){following=false;detailOffset=0;}
          else if(["up","k","down","j","pageup","pagedown"].includes(key.name??"")){
            following=false;
            const direction=["up","k","pageup"].includes(key.name??"")?-1:1;
            detailOffset=Math.max(0,detailOffset+direction*(["pageup","pagedown"].includes(key.name??"")?Math.max(1,(process.stdout.rows||30)-11):1));
          }
          draw();return;
        }
        if(key.name==="t"||timelineMode&&(key.name==="escape"||key.name==="backspace")){
          timelineMode=!timelineMode;timelineEpoch++;
          if(timelineMode)void loadTimeline();
          draw();return;
        }
        if(timelineMode){
          const events=timelineVisible(),index=Math.max(0,events.findIndex(row=>row.id===timelineSelected));
          if(key.name==="return"&&events[index]){
            detailPath=events[index].path;detailData=undefined;detailRevision="";detailError="";detailLoading=false;detailEpoch++;detailOffset=0;following=true;
            void loadDetail(true);
          }else if(["up","k","down","j","pageup","pagedown"].includes(key.name??"")){
            timelineFollowing=false;
            const step=["up","k","pageup"].includes(key.name??"")?-1:1;
            const amount=["pageup","pagedown"].includes(key.name??"")?Math.max(1,Math.floor(((process.stdout.rows||30)-10)/3)):1;
            timelineSelected=events[Math.max(0,Math.min(events.length-1,index+step*amount))]?.id??"";
          }else if(key.name==="home"||key.name==="f"){timelineFollowing=key.name==="home"||!timelineFollowing;timelineSelected="";}
          else if(key.name==="p")paused=!paused;
          else if(key.name==="r"){resetTimeline(true);void refresh(true);}
          else if(key.name==="l"){timelineLimit=timelineLimit===20?50:timelineLimit===50?100:20;resetTimeline();void loadTimeline();}
          else if(key.name==="g")projectPicker={items:[...observedProjects].sort(),selected:timelineProjects===null?null:new Set(timelineProjects),index:0};
          else if(text==="/")edit={kind:"search",text:query,path:""};
          else {
            const number=text??key.name??"";
            const shortcuts:Record<string,string>={"1":"human","2":"output","3":"tools","4":"main","5":"subagents"};
            const group=shortcuts[number];
            if(group){const set=["main","subagents"].includes(group)?sourceGroups:eventGroups;if(set.has(group))set.delete(group);else set.add(group);timelineSelected="";}
          }
          draw();return;
        }
        if(key.name==="return"&&rows[current]){
          detailPath=rows[current].path;detailData=undefined;detailRevision="";detailError="";detailLoading=false;detailEpoch++;detailOffset=0;following=true;
          void loadDetail(true);draw();return;
        }
        if (["up", "k", "down", "j"].includes(key.name ?? "")) {
          const step = ["up", "k"].includes(key.name ?? "") ? -1 : 1;
          selectedPath = rows[Math.max(0, Math.min(rows.length - 1, current + step))]?.path ?? "";
        } else if (key.name === "n" && rows[current]) edit = { kind: "name", text: names[rows[current].path] ?? "", path: rows[current].path };
        else if (text === "/") edit = { kind: "search", text: query, path: "" };
        else if (key.name === "a") { all = !all; selectedPath = ""; }
        else if (key.name === "p") paused = !paused;
      }
      draw();
    }
    const onKeypress = (...args: Parameters<typeof keypress>) => { void keypress(...args).catch(fail); };
    process.stdin.on("error", fail);
    process.stdout.on("error", fail);
    emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("keypress", onKeypress);
    process.stdout.on("resize", draw);
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    process.stdout.write("\x1b[?1049h\x1b[?25l");
    draw();
    if (!stopped) timer = setTimeout(refresh, 2000);
  });
  } finally { cleanup(); }
}
