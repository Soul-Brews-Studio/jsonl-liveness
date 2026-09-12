import {test,expect} from "bun:test";
import type {TimelineRow} from "./timeline";
import {updateTuiFeed} from "./tui-feed";
const row=(id:string,time:number):TimelineRow=>({id,path:id+".jsonl",sessionId:id,project:"demo",name:null,tier:"session",timestamp:new Date(time).toISOString(),kind:"message",role:"user",title:"User",text:id,truncated:false});
test("newest seed, append once at top and do not resurrect trimmed old rows",()=>{
 const a=row("a",1),b=row("b",2),c=row("c",3);
 let state=updateTuiFeed([], [a,b,c],new Set(),2);
 expect(state.rows.map(r=>r.id)).toEqual(["c","b"]);
 state=updateTuiFeed(state.rows,[a,b,c],state.seen,2);
 expect(state.rows.map(r=>r.id)).toEqual(["c","b"]);
 const d=row("d",4);
 state=updateTuiFeed(state.rows,[a,b,c,d],state.seen,2);
 expect(state.rows.map(r=>r.id)).toEqual(["d","c"]);
 expect(updateTuiFeed(state.rows,[{...d,text:"changed"},c],state.seen,2).rows[0].text).toBe("changed");
});
test("refresh reseeds and feed memory is bounded by fetched plus retained rows",()=>{
 const incoming=Array.from({length:200},(_,i)=>row(String(i),i));
 const state=updateTuiFeed([],incoming,new Set(),20);
 expect(state.rows.length).toBe(20);
 expect(state.seen.size).toBe(200);
 expect(updateTuiFeed([],incoming,new Set(),100).rows.length).toBe(100);
});

test("temporarily omitted events are not treated as new when they return",()=>{
 const a=row("a",1),b=row("b",2),c=row("c",3);
 let state=updateTuiFeed([], [a,b,c],new Set(),1);
 state=updateTuiFeed(state.rows, [c],state.seen,1);
 state=updateTuiFeed(state.rows, [a,b,c],state.seen,1);
 expect(state.rows.map(r=>r.id)).toEqual(["c"]);
});
