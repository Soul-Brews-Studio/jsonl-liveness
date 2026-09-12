import { test, expect } from "bun:test";
import { renderTuiDetail, type DetailView } from "./tui-detail";
import type { SessionDetail } from "./details";
const data:SessionDetail={path:"/fixture/demo.jsonl",events:[{id:"0",kind:"message",role:"user",title:"user",text:"First message",timestamp:null,truncated:false},{id:"1",kind:"tool-result",role:"user",title:"Tool result",text:"safe\u001b[2J output\n"+"tool output\n".repeat(30),timestamp:null,truncated:false}],bytesRead:100,fileSize:100,recordsRead:2,malformedRecords:0,hasOlder:false,partialLineHeld:true,headBytesRead:0,startedAt:null,endedAt:null,lastEventAt:null,lastUpdatedAt:"2026-09-12T00:00:00Z"};
const view:DetailView={path:data.path,data,loading:false,paused:false,following:true,newestFirst:false,offset:0,width:90,height:25};
test("TUI details wrap and scroll bounded safe text with honest timing",()=>{
 const frame=renderTuiDetail(view);expect(frame.offset).toBe(frame.maxOffset);
 expect(frame.text.split("\n").length).toBeLessThan(25);expect(frame.text).toContain("Esc back");expect(frame.text).toContain("partial line held");expect(frame.text).not.toContain("\u001b");
 const start=renderTuiDetail({...view,following:false,offset:0});expect(start.text).toContain("First message");expect(start.text).toContain("safe?[2J output");expect(start.text).toContain("Not recorded");
 const reversed=renderTuiDetail({...view,newestFirst:true});expect(reversed.offset).toBe(0);expect(reversed.text).toContain("Tool result");
});
