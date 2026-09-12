import {useEffect,useState,type MouseEvent} from "react";
import {claudeReturnURL,workspaceURL} from "../navigation";

export function WorkspaceNavigation(){
  const [url,setURL]=useState(()=>location.href),[open,setOpen]=useState(false);
  useEffect(()=>{const update=()=>{setURL(location.href);setOpen(false);};window.addEventListener("popstate",update);return()=>window.removeEventListener("popstate",update);},[]);
  const params=new URL(url).searchParams;
  const view=params.get("view")==="timeline"?"timeline":"table";
  function go(event:MouseEvent<HTMLAnchorElement>,href:string){
    if(event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
    event.preventDefault();
    if(href!==location.href)history.pushState(null,"",href);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }
  return <aside className="workspace-navigation" aria-label="Workspace navigation">
    <div className="workspace-brand"><a href={workspaceURL(url,"table")} onClick={e=>go(e,workspaceURL(url,"table"))}>JSONL Liveness</a><button type="button" className="workspace-menu-toggle" aria-label="Toggle navigation" aria-expanded={open} onClick={()=>setOpen(!open)}>Menu</button></div>
    <nav className={open?"workspace-links is-open":"workspace-links"} aria-label="Primary">
      <a href={workspaceURL(url,"table")} aria-current={view==="table"&&!params.has("session")?"page":undefined} onClick={e=>go(e,workspaceURL(url,"table"))}>Sessions</a>
      <a href={workspaceURL(url,"timeline")} aria-current={view==="timeline"?"page":undefined} onClick={e=>go(e,workspaceURL(url,"timeline"))}>Live Timeline</a>
      <a className="workspace-return" href={claudeReturnURL(url)}>← Back to Claude Code</a>
      <p>Read-only session activity.<br/>Your backend stays connected.</p>
    </nav>
  </aside>;
}
