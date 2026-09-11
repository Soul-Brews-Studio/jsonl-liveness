import { useEffect, useRef, useState } from "react";
import type { Fingerprint } from "../../fingerprint";
import type { FileRow } from "../model";
import { localTime } from "../model";
import type { Request } from "../useBackend";
export const isFingerprintStale = (file: FileRow, value: Fingerprint): boolean => !file.revision || !value.revision || value.revision !== file.revision;
export function HashCheck({file,request}:{file:FileRow;request:Request}) {
  const [value,setValue]=useState<Fingerprint>(),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  const pending=useRef<AbortController|null>(null);
  useEffect(()=>()=>pending.current?.abort(),[]);
  const stale=value&&isFingerprintStale(file,value);
  return <section aria-label="File change check" className="mt-5 rounded-lg border border-line bg-panel p-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-sm font-semibold">File change check</h3><button id="hash-check" disabled={busy} onClick={async()=>{
      const controller=new AbortController();pending.current=controller;setBusy(true);setError("");
      try{const data=await request(`/api/session/fingerprint?path=${encodeURIComponent(file.path)}${value?"&force=1":""}`,{signal:controller.signal}) as Fingerprint;if(!controller.signal.aborted)setValue(data);}
      catch(error){if(!controller.signal.aborted)setError(String(error));}finally{if(!controller.signal.aborted)setBusy(false);}
    }}>{busy?"Hashing…":value?"Recheck SHA-256":"Check SHA-256"}</button></div>
    <p className="mt-2 text-xs text-muted">Polling checks time and size, not hashes. This button reads the full file once; unchanged checks can reuse a cached hash.</p>
    <p id="mtime-value" className="mt-2 break-all font-mono text-xs">mtimeMs: {file.mtimeMs??"unavailable"}</p>
    {value&&<><code id="file-hash" className="mt-3 block break-all text-xs">{value.hash}</code><p className="mt-2 text-xs text-muted">{stale?"File changed since this hash — not rehashed automatically.":`Verified revision · ${value.cached?"cached":"computed"}`} · {localTime(value.hashedAt)}</p></>}
    {error&&<p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
  </section>;
}
