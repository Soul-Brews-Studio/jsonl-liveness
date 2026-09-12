import type { TimelineRow } from "./timeline";

/** Track the fetched window too, so dropped old events cannot reappear as new. */
export function updateTuiFeed(previous:TimelineRow[],incoming:TimelineRow[],seen:ReadonlySet<string>,limit:number){
  const latest=new Map(incoming.map(row=>[row.id,row]));
  const added=[...latest.values()].filter(row=>!seen.has(row.id))
    .sort((a,b)=>(Date.parse(b.timestamp??"")||0)-(Date.parse(a.timestamp??"")||0));
  const rows=[...added,...previous.map(row=>latest.get(row.id)??row)].slice(0,limit);
  // Retain a bounded recent history even if the server temporarily omits an event.
  const history=new Set([...seen,...incoming.map(row=>row.id),...rows.map(row=>row.id)]);
  while(history.size>10_000)history.delete(history.values().next().value!);
  return {rows,seen:history};
}
