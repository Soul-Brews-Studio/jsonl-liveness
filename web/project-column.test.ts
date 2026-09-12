import {test,expect} from "bun:test";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {SessionList} from "./components/SessionList";

test("overview keeps the original combined identity and extra columns are optional",()=>{
  const html=renderToStaticMarkup(createElement(SessionList,{
    selected:"",onSelect:()=>{},paused:false,busy:false,onPause:()=>{},
    onRefresh:()=>{},table:true,request:async()=>({})
  }));
  for(const label of ["Project / session ID"])expect(html).toContain(">"+label+"</th>");
  expect(html).toContain("Show project path");
  expect(html).toContain("Show IDs");
  expect(html).not.toContain(">Session ID</th>");
  expect(html).not.toContain(">Agent ID</th>");
  expect(html).toContain("session-overview w-full text-left text-xs");
  expect(html).not.toContain('>Project path</th>');
  expect(html).not.toContain('checked=""');
});

test("selection has a text label and does not retain the arrival fill",async()=>{
  const {readFile}=await import("node:fs/promises");
  const css=await readFile(new URL("./theme.css",import.meta.url),"utf8");
  expect(css).toContain(".session-row[data-selected=true] {outline:1px solid var(--accent)");
  expect(css).not.toContain(".session-row[data-selected=true] {--row-bg:var(--selected)");
  expect(css).not.toContain(".session-row[data-selected=true] {background:var(--selected)");
  const file={path:"/demo/id.jsonl",project:"/demo",tier:"session" as const,class:"warm" as const,age:120000,size:0};
  const html=renderToStaticMarkup(createElement(SessionList,{
    selected:file.path,onSelect:()=>{},paused:false,busy:false,onPause:()=>{},onRefresh:()=>{},
    table:true,request:async()=>({}),
    snapshot:{scannedAt:new Date().toISOString(),scanMs:0,counts:{hot:0,warm:1,cool:0,dead:0},errors:[],files:[file]}
  }));
  expect(html).toContain(">Selected</span>");
  expect(html).not.toContain('data-new="true"');
});
