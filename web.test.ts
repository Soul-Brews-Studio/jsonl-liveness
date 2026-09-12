import { test, expect } from "bun:test";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ActivityEvent } from "./web/components/ActivityEvent";
import { isSnapshot } from "./web/model";
import { SessionTiming } from "./web/components/SessionTiming";

function luminance(hex:string) {
  const channels=hex.match(/\w\w/g)!.map(value=>parseInt(value,16)/255).map(value=>value<=0.04045?value/12.92:((value+0.055)/1.055)**2.4);
  return channels[0]*0.2126+channels[1]*0.7152+channels[2]*0.0722;
}
function contrast(a:string,b:string) {const values=[luminance(a),luminance(b)].sort((a,b)=>b-a);return (values[0]+0.05)/(values[1]+0.05);}
test("all three theme palettes keep text and accent controls legible",async()=>{
  const css=await readFile(new URL("./web/theme.css",import.meta.url),"utf8");
  for(const selector of [":root",":root[data-theme=vangogh]",":root[data-theme=paper]"]) {
    const block=css.slice(css.indexOf(selector)).split("}")[0];
    const tokens=Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[\da-f]{6})/g)].map(match=>[match[1],match[2]]));
    for(const surface of ["canvas","surface","panel","code","selected"])
      for(const color of ["ink","muted","accent"])
        expect(contrast(tokens[color].slice(1),tokens[surface].slice(1))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(tokens["accent-ink"].slice(1),tokens.accent.slice(1))).toBeGreaterThanOrEqual(4.5);
  }
});
test("components can render independently and escape transcript content",()=>{
  const html=renderToStaticMarkup(createElement(ActivityEvent,{event:{id:"0:0",kind:"message",role:"user",title:"User",timestamp:null,text:'<img src=x onerror="alert(1)">',truncated:false}}));
  expect(html).toContain("&lt;img");expect(html).not.toContain("<img");
  const timing=renderToStaticMarkup(createElement(SessionTiming,{updated:"2026-09-11T10:00:00Z",loading:false}));
  expect(timing).toContain("Not recorded in this tail");expect(timing).toContain("Not found in first 64 KiB");
});

test("popup tools can default open without nested output clipping",()=>{
  const html=renderToStaticMarkup(createElement(ActivityEvent,{event:{id:"1:0",kind:"tool-result",role:"user",title:"Tool result",timestamp:null,text:"Latest tool output",truncated:false},defaultExpanded:true,unbounded:true}));
  expect(html).toContain('open=""');
  expect(html).not.toContain("max-h-80");
});

test("host client accepts older snapshots and validates optional revision tokens",()=>{
  const file={path:"/fixture/demo.jsonl",project:"demo",tier:"session",class:"hot",age:0,size:3};
  const snapshot={scannedAt:new Date().toISOString(),scanMs:0,counts:{hot:1,warm:0,cool:0,dead:0},errors:[],files:[file]};
  expect(isSnapshot(snapshot)).toBe(true);
  expect(isSnapshot({...snapshot,files:[{...file,revision:"stat-token"}]})).toBe(true);
  expect(isSnapshot({...snapshot,files:[{...file,revision:123}]})).toBe(false);
});
