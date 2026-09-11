import { useCallback, useEffect, useRef, useState } from "react";
import type { Snapshot } from "../source";
import { isSnapshot } from "./model";

export type Request = (path: string, init?: RequestInit) => Promise<unknown>;
export function useBackend(host: string, token: string) {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [error, setError] = useState("");
  const [paused, setPaused] = useState(false);
  const [busy, setBusy] = useState(false);
  const lifecycle = useRef<AbortController | null>(null);
  const inFlight = useRef(false), pausedRef = useRef(false);
  const request: Request = useCallback(async (path, init = {}) => {
    const response = await fetch(`${host}${path}`, {...init, redirect:"error",
      signal: AbortSignal.any([AbortSignal.timeout(10_000), ...(lifecycle.current ? [lifecycle.current.signal] : []), ...(init.signal ? [init.signal] : [])]),
      headers: {...(init.headers as Record<string,string>), ...(token ? {Authorization:`Bearer ${token}`} : {})},
    });
    if (!response.ok) {
      if (response.status === 401) throw new Error("Token required or invalid. Enter the backend token and reconnect.");
      throw new Error(`Backend HTTP ${response.status}: ${(await response.text()).slice(0,160)}`);
    }
    return response.json();
  }, [host, token]);
  const refresh = useCallback(async (force = true) => {
    if (inFlight.current || (!force && pausedRef.current)) return;
    inFlight.current=true;setBusy(true);
    const signal=lifecycle.current?.signal;
    try {
      const data=await request("/api/snapshot");
      if(signal?.aborted || (!force && pausedRef.current))return;
      if(!isSnapshot(data))throw new Error("The selected host did not return a JSONL snapshot.");
      setSnapshot(data);setError("");
    } catch(failure) {
      if(!signal?.aborted && (force || !pausedRef.current))setError(`${String(failure)} Check the host, server and allowed frontend origin.`);
    } finally {inFlight.current=false;if(!signal?.aborted)setBusy(false);}
  }, [request]);
  useEffect(()=>{
    const controller=new AbortController();lifecycle.current=controller;
    let timer: ReturnType<typeof setTimeout>;
    const tick=async()=>{
      const start=performance.now();await refresh(false);
      if(!controller.signal.aborted)timer=setTimeout(tick,Math.max(100,1000-(performance.now()-start)));
    };
    void tick();
    return()=>{controller.abort();clearTimeout(timer);};
  },[refresh]);
  function pause() {pausedRef.current=!pausedRef.current;setPaused(pausedRef.current);if(!pausedRef.current)void refresh();}
  const status=error ? (snapshot ? "Disconnected · last snapshot shown" : "Disconnected") : paused ? "Paused" : snapshot ? "Live · every 1s" : "Connecting…";
  return {snapshot,error,paused,busy,pause,refresh,request,status};
}
