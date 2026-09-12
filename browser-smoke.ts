// Local DOM integration test (not a visual browser test). Uses an already-installed
// dev-only happy-dom via HAPPY_DOM_PATH; no runtime dependency or installation.
import { mkdtemp, mkdir, writeFile, appendFile, readFile, stat, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "./server";
import { remoteSource } from "./source";

const modulePath = process.env.HAPPY_DOM_PATH;
if (!modulePath) throw new Error("Set HAPPY_DOM_PATH to an existing happy-dom lib/index.js for this optional DOM test");
const { Window } = await import(modulePath);
const temporary = await mkdtemp(join(tmpdir(), "jsonl-web-smoke-"));
let first: Awaited<ReturnType<typeof startServer>> | undefined;
let second: Awaited<ReturnType<typeof startServer>> | undefined;
let window: any;
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function until(check: () => boolean, label: string) {
  const deadline = Date.now() + 5000;
  while (!check()) { if (Date.now()>deadline) throw new Error(`DOM timeout: ${label}\n${window?.document?.body?.textContent}`); await Bun.sleep(25); }
}
try {
  const rootA = join(temporary,"alpha"), rootB = join(temporary,"beta");
  await mkdir(rootA); await mkdir(rootB);
  const fileA = join(rootA,"alpha123.jsonl"), fileB = join(rootB,"beta456.jsonl");
  await writeFile(fileA,'{"type":"user"}\n');
  await writeFile(fileB,[
    JSON.stringify({type:"user",timestamp:"2026-09-11T01:00:00Z",message:{role:"user",content:"<b>User activity stays text</b>"}}),
    JSON.stringify({type:"assistant",timestamp:"2026-09-11T01:00:01Z",message:{role:"assistant",content:[
      {type:"text",text:"Assistant activity"},
      {type:"tool_use",name:"Read",input:{path:'<img src=x onerror="alert(1)">' }},
      {type:"tool_result",content:[{type:"text",text:"<script>Tool result stays text</script>"}]},
    ]}}),
    '{"type":"assistant","message":{"role":"assistant","content":"PARTIAL ACTIVITY MUST STAY HIDDEN"',
  ].join("\n"));
  const before = [await readFile(fileB,"utf8"),(await stat(fileB)).mtimeMs];
  first = await startServer({root:rootA,port:0,namesFile:join(temporary,"a-names.json")});
  second = await startServer({root:rootB,port:0,namesFile:join(temporary,"b-names.json"),token:"test-token",allowedOrigins:[first.url]});
  const html = await (await fetch(first.url)).text();
  assert(html.includes("JSONL Liveness"),"HTML not served");
  assert((await fetch(`${first.url}/main.js`)).headers.get("content-type")?.includes("javascript"),"JS bundle not served");
  window = new Window({url:`${first.url}/?host=${encodeURIComponent(second.url)}`});
  window.AbortController = AbortController; window.AbortSignal = AbortSignal;
  let reads=0;
  let delayNameResponse = false;
  let releaseNameResponse: (() => void) | undefined;
  const detailRequests: string[] = [];
  let hashRequests=0;const hashes=()=>hashRequests;
  let delayedDetailPath = "";
  let releaseDetailResponse: (() => void) | undefined;
  window.fetch = async (url: string, init: RequestInit = {}) => {
    if (url.endsWith("/api/snapshot")) reads++;
    if (url.includes("/api/session/detail?")) detailRequests.push(url);
    if (url.includes("/api/session/fingerprint?")) hashRequests++;
    const response = await fetch(url,{...init,headers:{...(init.headers as Record<string,string>),Origin:first!.url}});
    if (delayNameResponse && init.method === "PUT") await new Promise<void>(resolve=>{releaseNameResponse=resolve;});
    if (delayedDetailPath && url.includes("/api/session/detail?") && new URL(url).searchParams.get("path")===delayedDetailPath) {
      await new Promise<void>(resolve=>{releaseDetailResponse=resolve;});
    }
    return response;
  };
  window.document.write(html.replace(/<script[\s\S]*?<\/script>/g,""));
  const bundle = await Bun.build({entrypoints:[join(import.meta.dir,"web/main.ts")],target:"browser",format:"iife"});
  assert(bundle.success,"Browser build failed");
  const execute = new Function("window", "document", "location", "history", "localStorage", "fetch", "AbortController", "AbortSignal", "setTimeout", "clearTimeout", await bundle.outputs[0].text());
  execute(window, window.document, window.location, window.history, window.localStorage, window.fetch, AbortController, AbortSignal, window.setTimeout.bind(window), window.clearTimeout.bind(window));
  const $ = (id: string) => window.document.getElementById(id);
  const submit = (id: string) => $(id).dispatchEvent(new window.Event("submit",{bubbles:true,cancelable:true}));
  const input = async (id: string,value: string) => {Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value")!.set!.call($(id),value);$(id).dispatchEvent(new window.Event("input",{bubbles:true}));await Bun.sleep(0);};
  await until(()=>!!$("error"),"React mount");
  assert(window.document.documentElement.dataset.theme==="paper","Paper is not the default theme");
  assert($("theme-paper").getAttribute("aria-pressed")==="true","Paper theme choice is not selected");
  await until(()=>$("error").textContent.includes("Token required"),"auth error");
  await input("token","test-token");submit("connect-form");
  await until(()=>$("rows").textContent.includes("beta456"),"selected backend snapshot");
  await until(()=>$("activity-list").textContent.includes("Assistant activity"),"selected session activity");
  assert($("workspace").dataset.view==="table","original table is not the default view");
  await until(()=>$("rows").querySelector(".message-preview")?.textContent.includes("Assistant activity"),"table recent message preview");
  assert(Date.parse($("rows").querySelector(".message-preview time")?.dateTime)===Date.parse("2026-09-11T01:00:01Z"),"message timestamp missing from preview");
  $("rows").querySelector("tr td:nth-child(2)").click();
  await until(()=>$("workspace").dataset.view==="live","clicking a session row opens conversation details");
  assert($("live-dialog")?.open,"session popup is not open");
  $("live-dialog").dispatchEvent(new window.Event("cancel",{cancelable:true}));
  await until(()=>$("workspace").dataset.view==="table" && !$("live-dialog"),"Escape closes the popup");
  $("rows").querySelector("tr td:nth-child(2)").click();
  await until(()=>$("live-dialog")?.open,"reopen session popup");
  assert(new URL(window.location.href).searchParams.get("session")==="beta456","selected session missing from URL");
  window.history.back();await until(()=>$("workspace").dataset.view==="table","browser Back returns to table");
  window.history.forward();await until(()=>$("workspace").dataset.view==="live","browser Forward restores details");
  await input("search","beta");
  $("back-sessions").click();await until(()=>$("workspace").dataset.view==="table","Back to sessions button");
  assert($("search").value==="beta","Back lost table search");await input("search","");
  assert(!new URL(window.location.href).searchParams.has("session"),"Back retained stale detail URL");
  $("view-table").click();await until(()=>$("workspace").dataset.view==="table","table toggle");
  $("view-live").click();await until(()=>$("workspace").dataset.view==="live","live toggle");
  // Remount at the detail URL as a hard refresh would: host/route persist, token does not.
  window.dispatchEvent(new window.Event("pagehide"));
  window.document.body.innerHTML='<div id="root"></div>';
  execute(window, window.document, window.location, window.history, window.localStorage, window.fetch, AbortController, AbortSignal, window.setTimeout.bind(window), window.clearTimeout.bind(window));
  await until(()=>$("error")?.textContent.includes("Token required"),"refresh requires memory-only token again");
  assert($("token").value==="","refresh persisted token");
  assert(!$("live-dialog"),"modal blocks token entry after refresh");
  await input("token","test-token");submit("connect-form");
  await until(()=>$("activity-list")?.textContent.includes("Assistant activity"),"detail URL restored after refresh/reconnect");
  assert($("workspace").dataset.view==="live" && $("detail-id").textContent==="beta456","refresh lost detail route");
  $("theme-vangogh").click();
  await until(()=>window.document.documentElement.dataset.theme==="vangogh","Van Gogh theme");
  assert(window.localStorage.getItem("jsonl-liveness-theme")==="vangogh","theme not persisted");
  $("theme-paper").click();
  await until(()=>window.document.documentElement.dataset.theme==="paper","Paper theme");
  assert(window.localStorage.getItem("jsonl-liveness-theme")==="paper","Paper theme not persisted");
  $("theme-vangogh").click();
  await until(()=>window.document.documentElement.dataset.theme==="vangogh","restore Van Gogh theme");
  $("dialog-home").click();await until(()=>$("workspace").dataset.view==="table","popup title link returns home");
  assert(window.document.activeElement?.dataset.sessionPath,"Home did not restore row focus after refresh");
  $("home").click();
  assert(!new URL(window.location.href).searchParams.has("session"),"home retained detail URL");
  assert($("host").value===second.url && $("token").value==="test-token","home disconnected the backend");
  assert(window.document.documentElement.dataset.theme==="vangogh","home reset the theme");
  await until(()=>$("rows").querySelector(".message-preview")?.textContent.includes("Assistant activity"),"home restores message previews");
  window.history.back();await until(()=>$("workspace").dataset.view==="live","Back restores details after Home");
  assert($("detail-start").textContent===new Date("2026-09-11T01:00:00Z").toLocaleString(),"start timestamp not visible");
  assert($("detail-end").textContent.includes("Not recorded"),"missing end timestamp was invented");
  assert($("detail-updated").textContent===(await stat(fileB)).mtime.toLocaleString(),"last update not visible");
  assert(hashes()===0,"polling computed a hash without being asked");
  $("hash-check").click();await until(()=>$("file-hash")?.textContent.length===64,"on-demand SHA-256");
  assert(hashes()===1,"explicit hash check did not make exactly one request");
  assert($("activity-list").textContent.includes("<b>User activity stays text</b>"),"user activity not rendered");
  assert($("activity-list").querySelectorAll("details")[1].open,"latest tool did not open by default");
  assert(!$("activity-list").className.includes("overflow-auto"),"popup has nested conversation scroll clipping");
  assert(!$("activity-list").querySelector("pre").className.includes("max-h-80"),"popup output is height clipped");
  assert($("activity-list").querySelectorAll("details").length===2,"tool use/result were not rendered as expandable disclosures");
  assert($("activity-list").textContent.includes('"path": "<img src=x onerror=\\"alert(1)\\">"'),"tool use input not rendered");
  assert($("activity-list").textContent.includes("<script>Tool result stays text</script>"),"tool result not rendered");
  assert($("activity-list").querySelectorAll("img,script").length===0,"session activity became HTML");
  assert(!$("activity-list").textContent.includes("PARTIAL ACTIVITY MUST STAY HIDDEN"),"partial activity line was rendered");
  assert($("activity-status").textContent.includes("partial line held back"),"partial-line hold-back not reported");
  $("activity-more").click();
  await until(()=>detailRequests.some(url=>new URL(url).searchParams.get("bytes")==="1048576"),"larger activity tail request");
  assert(window.localStorage.getItem("jsonl-liveness-host")===second.url,"host not persisted");
  assert(!JSON.stringify(window.localStorage).includes("test-token"),"token leaked into localStorage");
  await input("name",'<img src=x onerror="alert(1)">');submit("name-form");
  await until(()=>$("name-status").textContent.includes("Name saved"),"name save");
  await until(()=>$("rows").textContent.includes("<img src=x"),"live alias display");
  assert($("rows").querySelectorAll("img").length===0,"Alias became HTML");
  assert((await remoteSource(second.url,"test-token").read()).files[0].name!.startsWith("<img"),"name not shared with CLI source");
  await input("search","does-not-exist");assert(!$("empty").hidden,"empty filter state absent");
  await input("search","");assert($("empty").hidden,"search reset failed");
  // A pending save must not replace an unsaved draft on another selected row.
  const otherFile = join(rootB,"other789.jsonl");
  await writeFile(otherFile,JSON.stringify({type:"user",message:{role:"user",content:"Other session activity"}})+"\n"+JSON.stringify({type:"assistant",message:{content:[{type:"tool_use",name:"Bash",input:{command:"printf fixture"}}]}})+"\n");
  await second.service.refresh();
  $("refresh").click();
  await until(()=>$("rows").textContent.includes("other789"),"second row");
  assert($("rows").textContent.includes("Open: unknown"),"missing PID must be unknown, not closed");
  assert($("rows").parentElement.textContent.includes("File touched"),"file timestamp label still ambiguous");
  const order=()=>Array.from($("rows").querySelectorAll("[data-session-path]")).map((button:any)=>button.dataset.sessionPath);
  const priorOrder=order();const priorHashes=hashes();
  await until(()=>!$("rows").querySelector("tr[data-new=true]"),"initial highlight settles");
  await utimes(otherFile,new Date(),new Date(Date.now()+1000));
  await second.service.refresh();$("refresh").click();
  await until(()=>!$("refresh").disabled,"touch refresh complete");
  assert(JSON.stringify(order())===JSON.stringify(priorOrder),"touch-only change reordered messages");
  assert(!$("rows").querySelector("tr[data-new=true]"),"file touch incorrectly flashed a new-message row");
  await appendFile(otherFile,JSON.stringify({type:"assistant",timestamp:"2026-09-12T01:00:00Z",message:{content:"Newest conversation message"}})+"\n");
  await second.service.refresh();$("refresh").click();
  await until(()=>order()[0]===otherFile,"new message moves above older messages");
  await until(()=>$("rows").querySelector("tr")?.dataset.new==="true","new top row fades in");
  assert(hashes()===priorHashes,"touch/message polling unexpectedly hashed a file");
  const selectPath = (path: string) => Array.from(window.document.querySelectorAll("[data-session-path]")).find((button: any)=>button.dataset.sessionPath===path) as any;
  const select = async (path: string) => {selectPath(path).click();await until(()=>$("detail-id")?.textContent===path.split("/").at(-1)!.replace(/\.jsonl$/,""),"React selected session");};
  await select(otherFile);
  await until(()=>$("activity-list").textContent.includes("Other session activity"),"other session activity");
  assert(!$("activity-list").textContent.includes("Assistant activity"),"previous selection activity was not replaced");
  await select(fileB);
  await until(()=>$("activity-list").textContent.includes("Assistant activity"),"original session activity restored");
  delayedDetailPath=fileB;
  $("activity-refresh").click();
  await until(()=>!!releaseDetailResponse,"delayed old detail response");
  await select(otherFile);
  await until(()=>$("activity-list").textContent.includes("Other session activity"),"new selection activity while old request delayed");
  delayedDetailPath="";releaseDetailResponse!();
  await Bun.sleep(50);
  assert($("activity-list").textContent.includes("Other session activity"),"late detail response replaced the new selection");
  assert(!$("activity-list").textContent.includes("Assistant activity"),"late old selection activity leaked into the new selection");
  // Prove actual automatic 1-second polling, not a one-shot details pane.
  const tool=$("activity-list").querySelector("details");tool.open=true;
  $("activity-follow").click();await until(()=>$("activity-follow").getAttribute("aria-pressed")==="false","disable follow");
  $("activity-list").scrollTop=17;
  await appendFile(otherFile,JSON.stringify({type:"assistant",timestamp:"2026-09-11T12:00:00Z",message:{content:"APPENDED LIVE MESSAGE"}})+"\n");
  await until(()=>$("activity-list").textContent.includes("APPENDED LIVE MESSAGE"),"automatically appended message");
  assert($("activity-list").querySelector("details")===tool && tool.open,"poll replaced/collapsed the open tool");
  assert($("activity-list").scrollTop===17,"live update jumped away from reading position");
  const articles=$("activity-list").querySelectorAll("article");
  assert(articles[articles.length-1].textContent.includes("APPENDED LIVE MESSAGE"),"conversation is not chronological");
  $("activity-order").value="newest";$("activity-order").dispatchEvent(new window.Event("change",{bubbles:true}));
  await until(()=>$("activity-list").querySelector("article").textContent.includes("APPENDED LIVE MESSAGE"),"newest-first puts latest at top");
  $("activity-jump").click();assert($("live-scroll").scrollTop===0,"jump to newest did not return to top");
  $("activity-order").value="oldest";$("activity-order").dispatchEvent(new window.Event("change",{bubbles:true}));
  await until(()=>!$("activity-list").querySelector("article").textContent.includes("APPENDED LIVE MESSAGE"),"oldest-first restored");
  const detailReads=detailRequests.length;await Bun.sleep(2200);
  assert(detailRequests.length===detailReads,"unchanged transcript was needlessly reread");
  assert(hashes()===1,"live updates automatically rehashed a file");
  if($("activity-follow").getAttribute("aria-pressed")!=="true")$("activity-follow").click();
  await until(()=>$("activity-follow").getAttribute("aria-pressed")==="true","resume following");
  await select(fileB);
  delayNameResponse=true;
  await input("name","Saved on original");submit("name-form");
  await until(()=>!!releaseNameResponse,"delayed rename response");
  await select(otherFile);await input("name","Unsubmitted second draft");
  delayNameResponse=false;releaseNameResponse!();
  await until(()=>!$("save-name").disabled,"rename completion");
  assert($("name").value==="Unsubmitted second draft","late save overwrote another session's draft");
  assert(!$("name-status").textContent.includes("Name saved"),"late save claimed the new row was saved");
  assert((await remoteSource(second.url,"test-token").read()).files.find(file=>file.path===otherFile)?.name===null,"unsaved draft persisted unexpectedly");
  $("pause").click();const pausedReads=reads;await Bun.sleep(2200);assert(reads===pausedReads,"pause continued polling");
  await input("host",first.url);assert($("token").value==="","host change retained old token");submit("connect-form");
  await until(()=>$("rows").textContent.includes("alpha123"),"switch to second backend");
  assert(!$("rows").textContent.includes("beta456"),"previous-host rows leaked");
  assert(await readFile(fileB,"utf8")===before[0] && (await stat(fileB)).mtimeMs===before[1],"transcript mutated");
  await until(()=>!$("refresh").disabled,"finished initial refresh");
  $("pause").click();
  first.stop();
  $("refresh").click();await until(()=>$("connection").textContent.includes("Disconnected"),"disconnected stale state");
  assert($("rows").textContent.includes("alpha123"),"last snapshot lost on disconnect");
  console.log("React DOM + HTTP PASS: click-to-detail, Back button/browser Back/Forward, refresh route restoration, live append, stable tools/scroll, bounded rereads, timing, themes, host/auth/switch, safe text, partial hold-back, selection race, aliases/drafts, search/pause/disconnect; protected fixture unchanged");
} finally {
  window?.dispatchEvent(new window.Event("pagehide"));
  await window?.happyDOM.abort();
  window?.close();
  first?.stop();second?.stop();
  await rm(temporary,{recursive:true,force:true});
}
