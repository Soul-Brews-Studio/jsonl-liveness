import { test, expect } from "bun:test";
import { mkdtemp, writeFile, appendFile, readFile, stat, symlink, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSessionDetail, MAX_DETAIL_BYTES } from "./details";
import { startServer } from "./server";

async function fixture(run: (root: string,file: string)=>Promise<void>) {
  const root=await mkdtemp(join(tmpdir(),"jsonl-details-"));
  try {await run(root,join(root,"session.jsonl"));}
  finally {await rm(root,{recursive:true,force:true});}
}
test("details expose text and tools, never partial records or thinking",async()=>{
  await fixture(async(root,file)=>{
    const records=[
      {type:"user",timestamp:"2026-09-11T10:00:00Z",message:{role:"user",content:"Please inspect this"}},
      {type:"assistant",message:{role:"assistant",content:[{type:"thinking",thinking:"private reasoning"},{type:"text",text:"Reading files"},{type:"tool_use",name:"Read",input:{file_path:"README.md"}}]}},
      {type:"user",message:{role:"user",content:[{type:"tool_result",content:"file contents",is_error:false}]}},
    ];
    const content=records.map(r=>JSON.stringify(r)).join("\n")+'\n{"unfinished":';
    await writeFile(file,content);
    const before=await stat(file);
    const detail=await readSessionDetail(root,file);
    expect(detail.events.map(event=>event.kind)).toEqual(["message","message","tool-use","tool-result"]);
    expect(detail.events[0].text).toBe("Please inspect this");
    expect(detail.events[2].text).toContain("README.md");
    expect(detail.partialLineHeld).toBe(true);
    expect(JSON.stringify(detail)).not.toContain("private reasoning");
    expect(await readFile(file,"utf8")).toBe(content);
    expect((await stat(file)).mtimeMs).toBe(before.mtimeMs);
  });
});
test("detail tail is bounded, omits leading fragments and reports malformed records",async()=>{
  await fixture(async(root,file)=>{
    await writeFile(file,'x'.repeat(10000)+'\n{bad}\n'+JSON.stringify({type:"assistant",message:{content:"last complete"}})+'\n');
    const detail=await readSessionDetail(root,file,256);
    expect(detail.bytesRead).toBe(256);
    expect(detail.hasOlder).toBe(true);
    expect(detail.malformedRecords).toBe(1);
    expect(detail.events[0].text).toBe("last complete");
    await writeFile(file,'{"type":"user","content":"unfinished"}');
    expect((await readSessionDetail(root,file)).events).toEqual([]);
    await expect(readSessionDetail(root,file,MAX_DETAIL_BYTES+1)).rejects.toThrow();
  });
});
test("authenticated detail API rejects unknown paths and symlink escape",async()=>{
  await fixture(async(root,file)=>{
    await writeFile(file,JSON.stringify({type:"user",content:"fixture detail"})+'\n');
    const outside=await mkdtemp(join(tmpdir(),"jsonl-outside-"));
    const target=join(outside,"secret.jsonl");
    await writeFile(target,'{"content":"outside"}\n');
    const link=join(root,"link.jsonl");await symlink(target,link);
    const running=await startServer({root,port:0,token:"fixture-token",namesFile:join(root,"names.json")});
    try {
      const url=(path:string)=>`${running.url}/api/session/detail?path=${encodeURIComponent(path)}`;
      expect((await fetch(url(file))).status).toBe(401);
      const headers={Authorization:"Bearer fixture-token"};
      expect((await (await fetch(url(file),{headers})).json()).events[0].text).toBe("fixture detail");
      expect((await fetch(url("/etc/passwd"),{headers})).status).toBe(403);
      expect((await fetch(url(link),{headers})).status).toBe(403);
      expect((await fetch(url(file)+"&bytes=999999999",{headers})).status).toBe(400);
    } finally {running.stop();await rm(outside,{recursive:true,force:true});}
  });
});
test("session timing uses recorded timestamps and file mtime, not turn completion or inactivity",async()=>{
  await fixture(async(root,file)=>{
    const start="2026-09-11T10:00:00.000Z", update="2026-09-11T11:00:00.000Z";
    const records=[
      {type:"last-prompt"},
      {type:"user",timestamp:"invalid",message:{content:"invalid date"}},
      {type:"user",timestamp:start,message:{content:"start"}},
      {type:"assistant",timestamp:"2026-09-11T10:01:00Z",message:{content:"done for now",stop_reason:"end_turn"}},
      {type:"system",subtype:"stop_hook_summary",timestamp:"2026-09-11T10:02:00Z"},
    ];
    const content=records.map(record=>JSON.stringify(record)).join("\n")+'\n';
    await writeFile(file,content);await utimes(file,new Date(update),new Date(update));
    const detail=await readSessionDetail(root,file);
    expect(detail.startedAt).toBe(start);
    expect(detail.endedAt).toBeNull();
    expect(detail.lastUpdatedAt).toBe(update);
    expect(detail.lastEventAt).toBe("2026-09-11T10:02:00.000Z");
    const ending=JSON.stringify({type:"session_end",timestamp:"2026-09-11T10:03:00Z"});
    await writeFile(file,content+ending); // A syntactically valid but uncommitted end is held back.
    expect((await readSessionDetail(root,file)).endedAt).toBeNull();
    await writeFile(file,content+ending+'\n');
    expect((await readSessionDetail(root,file)).endedAt).toBe("2026-09-11T10:03:00.000Z");
    await writeFile(file,content+ending+'\n'+JSON.stringify({type:"user",timestamp:"2026-09-11T10:04:00Z",content:"resumed"})+'\n');
    expect((await readSessionDetail(root,file)).endedAt).toBeNull();
  });
});
test("start time reads a bounded head, leaves unknown timestamps unknown",async()=>{
  await fixture(async(root,file)=>{
    const start=JSON.stringify({type:"user",timestamp:"2026-09-11T08:00:00Z",content:"first"})+'\n';
    const middle=JSON.stringify({type:"attachment",data:"x".repeat(300000)})+'\n';
    const tail=JSON.stringify({type:"assistant",timestamp:"2026-09-11T10:00:00Z",content:"latest"})+'\n';
    await writeFile(file,start+middle+tail);
    const detail=await readSessionDetail(root,file);
    expect(detail.startedAt).toBe("2026-09-11T08:00:00.000Z");
    expect(detail.headBytesRead).toBe(64*1024);
    expect(detail.bytesRead).toBe(256*1024);
    await writeFile(file,middle+tail);
    expect((await readSessionDetail(root,file)).startedAt).toBeNull();
    await writeFile(file,'{"type":"user","timestamp":"2026-09-11T08:00:00Z"}');
    expect((await readSessionDetail(root,file)).startedAt).toBeNull();
  });
});
test("event identities survive larger windows; workflow results are not session ends",async()=>{
  await fixture(async(root,file)=>{
    await writeFile(file,JSON.stringify({type:"user",content:"x".repeat(800)})+'\n'+[
      {type:"started",key:"review",agentId:"fixture-agent"},
      {type:"result",key:"review",result:{result:"Review complete",thinking:"not displayed"}},
    ].map(record=>JSON.stringify(record)).join("\n")+'\n');
    const small=await readSessionDetail(root,file,256),large=await readSessionDetail(root,file,1024);
    expect(small.events.at(-1)?.id).toBe(large.events.at(-1)?.id);
    expect(small.events.at(-1)?.text).toContain("Review complete");
    expect(small.endedAt).toBeNull();
    expect(JSON.stringify(small.events)).not.toContain("not displayed");
  });
});
test("visible-row preview finds text behind system events, caches and invalidates on writes",async()=>{
  await fixture(async(root,file)=>{
    const initial=[
      {type:"assistant",message:{role:"assistant",content:"Latest answer"}},
      {type:"system",subtype:"stop_hook_summary"},
    ].map(record=>JSON.stringify(record)).join("\n")+'\n';
    await writeFile(file,initial);
    const running=await startServer({root,port:0,token:"preview-token",namesFile:join(root,"names.json")});
    try {
      const url=`${running.url}/api/session/preview?path=${encodeURIComponent(file)}`;
      expect((await fetch(url)).status).toBe(401);
      expect((await (await fetch(url,{headers:{Authorization:"Bearer preview-token"}})).json()).text).toBe("Latest answer");
      const first=await running.service.preview(file);
      expect(await running.service.preview(file)).toBe(first);
      const before=await stat(file), firstRevision=(await running.service.snapshot()).files[0].revision;
      const replacement=initial.replace("Latest answer","Newest answer");
      expect(Buffer.byteLength(replacement)).toBe(Buffer.byteLength(initial));
      await Bun.sleep(5);await writeFile(file,replacement);await utimes(file,before.atimeMs/1000,before.mtimeMs/1000);
      await running.service.refresh();
      const rewritten=(await running.service.snapshot()).files[0];
      expect(rewritten.mtimeMs).toBe(before.mtimeMs);expect(rewritten.size).toBe(before.size);
      expect(rewritten.revision).not.toBe(firstRevision);
      expect((await running.service.preview(file)).text).toBe("Newest answer");
      await appendFile(file,JSON.stringify({type:"user",message:{role:"user",content:"Next question"}})+'\n');
      await running.service.refresh();
      expect((await running.service.preview(file)).text).toBe("Next question");
      const sizeBefore=(await stat(file)).size;const writeBefore=(await stat(file)).mtimeMs;
      const detail=await readSessionDetail(root,file,64*1024,false);
      expect(detail.headBytesRead).toBe(0);expect(detail.startedAt).toBeNull();
      expect((await stat(file)).mtimeMs).toBe(writeBefore);expect((await stat(file)).size).toBe(sizeBefore);
      expect(before.mtimeMs).toBeGreaterThan(0);
    }finally{running.stop();}
  });
});
