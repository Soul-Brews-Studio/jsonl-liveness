import { useEffect, useState } from "react";
import type { Request } from "../useBackend";
export interface Preview {text:string;role:string|null;timestamp:string|null;truncated:boolean}
/** Each mounted (visible) row requests a small preview only when its file changes. */
export function MessagePreview({path,revision,request}:{path:string;revision:string;request:Request}) {
  const [preview,setPreview]=useState<Preview>(),[failed,setFailed]=useState(false);
  useEffect(()=>{
    const controller=new AbortController();let current=true;setFailed(false);
    request(`/api/session/preview?path=${encodeURIComponent(path)}`,{signal:controller.signal}).then(value=>{
      if(current){const data=value as Preview;if(!data||typeof data.text!=="string")throw new Error("Invalid preview");setPreview(data);}
    }).catch(()=>{if(current)setFailed(true);});
    return()=>{current=false;controller.abort();};
  },[path,revision,request]);
  return <div className="message-preview min-w-44 max-w-80 py-2" title={preview?.text}>
    {failed?<span className="text-muted">Preview unavailable · open details</span>:!preview?<span className="text-muted">Reading recent message…</span>:preview.text?<><span className="mb-1 block text-[10px] font-medium capitalize text-accent">{preview.role}</span><span className="line-clamp-2 whitespace-pre-wrap break-words text-xs leading-5 text-ink">{preview.text}{preview.truncated?"…":""}</span></>:<span className="text-muted">No message in last 64 KiB · open details</span>}
  </div>;
}
