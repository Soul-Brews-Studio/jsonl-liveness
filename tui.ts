import { renderTuiDetail } from "./tui-detail";
import type { SessionDetail } from "./details";
import { emitKeypressEvents } from "node:readline";
import { ageLabel, shortProject, sizeLabel } from "./display";
import { type scan, type Thresholds } from "./liveness";
import { sessionId, type Names } from "./names";
import { localSource, snapshotNames, type SessionSource } from "./source";

type Snapshot = Awaited<ReturnType<typeof scan>>;
type File = Snapshot["files"][number];
const clean = (value: string) => value.replace(/[\x00-\x1f\x7f-\x9f]/g, "?");
export function matchingFiles(snapshot: Snapshot, names: Names, all: boolean, query: string): File[] {
  return snapshot.files.filter(file => (all || file.class !== "dead") &&
    `${sessionId(file.path)} ${names[file.path] ?? ""} ${file.project} ${file.tier}`.toLowerCase().includes(query.toLowerCase()));
}
export function renderTui(snapshot: Snapshot, names: Names, files: File[], selected: number, width: number, height: number, footer: string): string {
  const limit = Math.max(1, height - 13);
  const offset = Math.max(0, selected - limit + 1);
  const lines = [
    `JSONL LIVENESS · ${snapshot.files.length} files · ${snapshot.scanMs}ms scan`,
    Object.entries(snapshot.counts).map(([state, count]) => `${count} ${state}`).join(" · "),
    "",
    "  SESSION ID      NAME / PROJECT                  LAST EVENT          AGE     SIZE",
  ];
  let previous = "";
  for (let i = offset; i < Math.min(files.length, offset + limit); i++) {
    const file = files[i];
    const group = file.class === previous ? " " : file.class.toUpperCase();
    previous = file.class;
    const rawId = sessionId(file.path);
    const id = rawId.startsWith("agent-") ? `a:${rawId.slice(6, 14)}` : rawId.slice(0, 12);
    const label = names[file.path] || shortProject(file.project);
    const event = file.type ? `${file.type}${file.role && file.role !== file.type ? `/${file.role}` : ""}` : "—";
    const row = `${i === selected ? ">" : " "} ${id.padEnd(14)}  ${clean(label).slice(0, 28).padEnd(28)}  ${clean(event).slice(0, 18).padEnd(18)} ${ageLabel(file.age).padStart(4)} ${sizeLabel(file.size).padStart(7)}  ${group}`;
    lines.push(row);
  }
  if (!files.length) lines.push("No matching files. Press a to include dead files, or / to change search.");
  const file = files[selected];
  lines.push("", `Showing ${files.length ? offset + 1 : 0}–${Math.min(files.length, offset + limit)} of ${files.length} matching files`);
  if (file) {
    lines.push(`${names[file.path] || "Unnamed"} · ${sessionId(file.path)} · ${file.tier} · ${file.class}`);
    lines.push(`Updated ${file.modifiedAt?new Date(file.modifiedAt).toLocaleString():new Date(Date.parse(snapshot.scannedAt)-file.age).toLocaleString()} · mtimeMs ${file.mtimeMs??"unknown"}`);
    lines.push(file.path);
  } else lines.push("", "");
  lines.push("Freshness is last write, not Working / Needs input / Completed.");
  lines.push(footer);
  return lines.slice(0, Math.max(1, height - 1)).map(line => Array.from(clean(line)).slice(0, Math.max(1, width - 1)).join("")).join("\n");
}

export async function watchTui(root: string, thresholds: Thresholds, source: SessionSource = localSource(root, thresholds)): Promise<void> {
  let snapshot = await source.read();
  let names = snapshotNames(snapshot);
  let selectedPath = "", query = "", all = false, paused = false, stopped = false, scanning = false;
  let edit: { kind: "name" | "search"; text: string; path: string } | undefined;
  let saving = false, message = "", timer: ReturnType<typeof setTimeout> | undefined;
  let detailPath="",detailData:SessionDetail|undefined,detailRevision="",detailLoading=false,detailError="",detailEpoch=0;
  let detailOffset=0,following=true,newestFirst=false;
  const help = "Enter detail · ↑↓/jk move · n name · / find · a all · p pause · q quit";
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
  async function refresh() {
    if (stopped || scanning) return;
    const start = performance.now();
    scanning = true;
    try {
      if (!paused) {
        snapshot = await source.read();
        if (!edit && !saving) names = snapshotNames(snapshot);
        await loadDetail();
      }
    } catch (error) { message = `Error: ${error}`; }
    finally {
      scanning = false;
      draw();
      if (!stopped) timer = setTimeout(refresh, Math.max(100, 1000 - (performance.now() - start)));
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
            detailOffset=Math.max(0,detailOffset+direction*(["pageup","pagedown"].includes(key.name??"")?Math.max(1,(process.stdout.rows||30)-9):1));
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
    if (!stopped) timer = setTimeout(refresh, 1000);
  });
  } finally { cleanup(); }
}
