import { useEffect, useRef, useState } from "react";
import type { FileRow } from "../model";
import type { Request } from "../useBackend";
export function NameForm({file,request,onSaved}:{file:FileRow;request:Request;onSaved:()=>void}) {
  const [name,setName]=useState(file.name??""),[dirty,setDirty]=useState(false),[saving,setSaving]=useState(false),[status,setStatus]=useState("");
  const mounted=useRef(true);
  useEffect(()=>()=>{mounted.current=false;},[]);
  useEffect(()=>{if(!dirty)setName(file.name??"");},[file.name,dirty]);
  return <form id="name-form" className="mt-6 border-t border-line pt-5" onSubmit={async e=>{
    e.preventDefault();if(saving)return;
    const value=name.trim();if(Array.from(value).length>80||/[\x00-\x1f\x7f-\x9f]/.test(value)){setStatus("Use at most 80 characters, without control characters.");return;}
    setSaving(true);try{await request("/api/names",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({path:file.path,name:value})});
      if(mounted.current){setDirty(false);setStatus("Name saved. Transcript unchanged.");onSaved();}
    }catch(error){if(mounted.current)setStatus(`Not saved: ${String(error)}`);}finally{if(mounted.current)setSaving(false);}
  }}><label className="block max-w-md text-xs font-medium">Display name<input id="name" maxLength={160} placeholder="e.g. jsonl lead" value={name} onChange={e=>{setName(e.target.value);setDirty(true);setStatus("");}}/></label><p className="my-2 text-xs text-muted">Up to 80 characters. Empty removes the name. Session IDs never change.</p><button id="save-name" className="primary" disabled={saving}>Save name</button><p id="name-status" className="mt-2 text-sm text-muted" role="status">{status}</p></form>;
}
