/** Missing/invalid times sort last; file touches never break a message-time tie. */
export function latestMessages<T extends {path:string;message?:{timestamp:string|null}}>(files:T[]):T[] {
  const timestamp=(file:T)=>{const time=Date.parse(file.message?.timestamp??"");return Number.isFinite(time)?time: -Infinity;};
  return files.toSorted((a,b)=> timestamp(b)-timestamp(a) || a.path.localeCompare(b.path));
}

export function openLabel(file:{presence?:{state:string;pids:number[]}}):string {
  return file.presence?.state==="open" && file.presence.pids.length
    ? `Open · PID ${file.presence.pids.join(", ")}` : "Open: unknown";
}
