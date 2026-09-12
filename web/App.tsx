import { WorkspaceNavigation } from "./components/WorkspaceNavigation";
import { Timeline } from "./components/Timeline";
import { useEffect, useState } from "react";
import { normalizeHost } from "../host";
import { fullID, lastWrite, type FileRow } from "./model";
import { useBackend } from "./useBackend";
import { SessionList } from "./components/SessionList";
import { SessionDialog } from "./components/SessionDialog";
import { Conversation } from "./components/Conversation";
import { initialTheme, themes } from "./theme";

const hostKey="jsonl-liveness-host",themeKey="jsonl-liveness-theme";
function saved(key:string){try{return localStorage.getItem(key);}catch{return null;}}
function remember(key:string,value:string){try{localStorage.setItem(key,value);}catch{}}
function initialHost(){const url=new URL(location.href);const value=url.searchParams.get("host")||saved(hostKey)||location.origin;if(url.searchParams.has("host")){url.searchParams.delete("host");history.replaceState(null,"",url);}return value;}
function currentRoute(){const params=new URL(location.href).searchParams;return {session:params.get("session"),path:params.get("path"),layout:params.get("view")==="timeline"?"timeline":"table"};}
function homeURL(){const url=new URL(location.href);url.searchParams.delete("view");url.searchParams.delete("session");url.searchParams.delete("path");return url;}
function Workspace({host,token}:{host:string;token:string}) {
  const backend=useBackend(host,token);
  const [selected,setSelected]=useState(""),[route,setRoute]=useState(currentRoute);
  const view=route.layout==="timeline"?"timeline":route.session?"live":"table";
  const matches=backend.snapshot?.files.filter(file=>fullID(file)===route.session && (!route.path||file.path===route.path));
  const file=route.session ? (matches?.length===1?matches[0]:undefined) : backend.snapshot?.files.find(file=>file.path===selected) || backend.snapshot?.files.find(file=>file.class!=="dead") || backend.snapshot?.files[0];
  useEffect(()=>{const navigate=()=>setRoute(currentRoute());window.addEventListener("popstate",navigate);return()=>window.removeEventListener("popstate",navigate);},[]);
  function navigate(next?:FileRow,layout="table") {
    const url=new URL(location.href);url.searchParams.delete("session");url.searchParams.delete("path");url.searchParams.delete("view");
    if(layout==="timeline")url.searchParams.set("view","timeline");
    if(next){setSelected(next.path);url.searchParams.set("session",fullID(next));if((backend.snapshot?.files.filter(file=>fullID(file)===fullID(next)).length??0)>1)url.searchParams.set("path",next.path);}
    if(url.href!==location.href)history.pushState(null,"",url);
    setRoute(currentRoute());
  }
  return <>
    <div className="my-5 flex flex-wrap items-center justify-between gap-3"><nav className="flex gap-2" aria-label="Workspace view"><button id="view-live" disabled={!file} aria-pressed={view==="live"} onClick={()=>navigate(file)}>Live conversation</button><button id="view-table" aria-pressed={view==="table"} onClick={()=>navigate()}>Table</button><button id="view-timeline" aria-pressed={view==="timeline"} onClick={()=>navigate(undefined,"timeline")}>Timeline</button></nav><p id="connection" role="status" data-state={backend.error?"error":backend.paused?"paused":backend.snapshot?"live":"connecting"} className="text-sm text-muted">{backend.status}</p></div>
    <p id="error" role="alert" hidden={!backend.error} className="mb-4 rounded-lg border border-danger p-4 text-sm text-danger">{backend.error}</p>
    <main id="workspace" data-view={view} className={`grid items-start gap-6 xl:min-h-0 xl:flex-1 xl:items-stretch ${view==="timeline"?"xl:grid-cols-1":"xl:grid-cols-[minmax(0,1fr)_420px]"}`}>
      <div hidden={view==="timeline"} className="min-h-0 min-w-0"><SessionList snapshot={backend.snapshot} selected={file?.path??""} onSelect={navigate} paused={backend.paused} busy={backend.busy} onPause={backend.pause} onRefresh={()=>void backend.refresh()} table={true} request={backend.request}/></div>
      <div hidden={view==="timeline"} id="sidebar-scroll" className="max-h-[70vh] min-h-0 min-w-0 overflow-y-auto rounded-xl border border-line bg-surface p-5 md:p-7 xl:h-full xl:max-h-none">{file&&backend.snapshot&&view==="table"?<Conversation key={file.path} file={file} updated={lastWrite(file,backend.snapshot.scannedAt)} request={backend.request} onNamed={()=>void backend.refresh()} paused={backend.paused} scrollTarget="sidebar-scroll"/>:<p id="detail-empty" className="py-16 text-center text-sm text-muted">{view==="live"?"Live conversation open in popup.":"Select a session to inspect its live conversation or set a name."}</p>}</div>
      <div hidden={view!=="timeline"} className="min-h-0 min-w-0"><Timeline snapshot={backend.snapshot} request={backend.request} active={view==="timeline"} paused={backend.paused} onPause={backend.pause} onRefresh={()=>backend.refresh()}/></div>
    </main>
    {view==="live"&&backend.snapshot&&<SessionDialog sessionPath={file?.path??""} onClose={()=>navigate()}>{file&&backend.snapshot?<Conversation key={file.path} file={file} updated={lastWrite(file,backend.snapshot.scannedAt)} request={backend.request} onNamed={()=>void backend.refresh()} paused={backend.paused} popup/>:<p className="py-12 text-center text-muted">{backend.snapshot?"Session unavailable or ambiguous on this backend.":"Connecting to the backend…"}</p>}</SessionDialog>}
    {!!backend.snapshot?.errors.length&&<details className="mt-6 text-sm text-danger"><summary>{backend.snapshot.errors.length} files or folders could not be read</summary><pre className="whitespace-pre-wrap break-all">{backend.snapshot.errors.join("\n")}</pre></details>}
    <footer className="mt-6 flex shrink-0 flex-wrap justify-between gap-3 border-t border-line pt-4 text-xs text-muted"><span id="scan-status">{backend.snapshot?`${backend.paused?"Paused at":"Updated"} ${new Date(backend.snapshot.scannedAt).toLocaleTimeString()} · ${backend.snapshot.scanMs} ms scan`:"Refreshes every 2 seconds"}</span><span>Read-only · file touch ≠ new message · open ≠ working</span></footer>
  </>;
}
export function App() {
  const [host,setHost]=useState(initialHost),[token,setToken]=useState("");
  const [connection,setConnection]=useState(()=>{try{return {host:normalizeHost(host),token:"",id:0};}catch{return null;}});
  const [error,setError]=useState("");
  const [theme,setTheme]=useState(()=>initialTheme(saved(themeKey)));
  useEffect(()=>{document.documentElement.dataset.theme=theme;remember(themeKey,theme);},[theme]);
  useEffect(()=>{if(connection){setHost(connection.host);remember(hostKey,connection.host);}},[connection]);
  return <div className="workspace-frame"><WorkspaceNavigation/><div id="app-shell" className="mx-auto max-w-[1800px] p-4 md:p-8 xl:flex xl:h-dvh xl:flex-col">
    <header className="mb-6 flex shrink-0 flex-wrap items-start justify-between gap-5"><div><h1 className="text-2xl font-semibold tracking-tight"><a id="home" href={homeURL().href} aria-label="JSONL Liveness home" className="rounded-sm hover:text-accent" onClick={e=>{if(e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;e.preventDefault();const url=homeURL();if(url.href!==location.href)history.pushState(null,"",url);window.dispatchEvent(new window.PopStateEvent("popstate"));}}>JSONL Liveness</a></h1><p className="mt-2 text-sm text-muted">Your sessions, as they happen. Your names. Your backend.</p></div><fieldset><legend className="mb-1 text-xs font-medium">Theme</legend><div id="theme-choices" className="flex flex-wrap gap-2">{themes.map(option=><button key={option.value} id={`theme-${option.value}`} type="button" aria-pressed={theme===option.value} onClick={()=>setTheme(option.value)}>{option.label}</button>)}</div></fieldset></header>
    <form id="connect-form" className="grid shrink-0 items-end gap-3 border-b border-line pb-5 md:grid-cols-[1.1fr_1fr_auto]" onSubmit={e=>{e.preventDefault();try{const next=normalizeHost(host);if(next!==connection?.host){const url=new URL(location.href);url.searchParams.delete("session");url.searchParams.delete("path");history.replaceState(null,"",url);}setConnection({host:next,token,id:(connection?.id??0)+1});setError("");}catch(failure){setError(String(failure));}}}>
      <label className="text-xs font-medium">Backend host<input id="host" placeholder="localhost:47881" required value={host} onChange={e=>{setHost(e.target.value);setToken("");}} spellCheck={false}/></label>
      <label className="text-xs font-medium">Token <span className="font-normal text-muted">optional · memory only</span><input id="token" type="password" placeholder="Bearer token if required" autoComplete="off" value={token} onChange={e=>setToken(e.target.value)}/></label>
      <button id="connect" className="primary" type="submit">Connect</button>
    </form>
    {error&&<p role="alert" className="my-4 text-danger">{error}</p>}
    {connection&&<Workspace key={connection.id} host={connection.host} token={connection.token}/>}
  </div></div>;
}
