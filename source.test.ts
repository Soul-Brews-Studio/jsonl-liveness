import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localSource, remoteSource } from "./source";
import type { TimelineSnapshot } from "./timeline";

async function fixture(run:(root:string)=>Promise<void>) {
  const root=await mkdtemp(join(tmpdir(),"jsonl-source-"));
  try { await run(root); }
  finally { await rm(root,{recursive:true,force:true}); }
}

function line(content:string,timestamp:string) {
  return JSON.stringify({type:"user",timestamp,content})+"\n";
}

test("local timeline reuses the latest source snapshot and cached tails",async()=>{
  await fixture(async root=>{
    const project=join(root,"-one");
    await mkdir(project);
    await writeFile(join(project,"first.jsonl"),line("first","2026-09-12T00:00:00Z"));
    const source=localSource(root,undefined,join(root,"names.json"));
    await source.read();

    await writeFile(join(project,"second.jsonl"),line("second","2026-09-12T00:01:00Z"));
    const cachedSnapshot=await source.timeline(undefined,20);
    expect(cachedSnapshot.rows.map(row=>row.text)).toEqual(["first"]);
    expect(cachedSnapshot.reads).toBe(1);
    expect((await source.timeline(undefined,20)).reads).toBe(0);

    await source.read();
    const refreshed=await source.timeline("/one",20);
    expect(refreshed.rows.map(row=>row.text)).toEqual(["second","first"]);
    expect(refreshed.reads).toBe(1);
  });
});

test("remote timeline sends repeated project filters and validates responses",async()=>{
  const result:TimelineSnapshot={
    rows:[],scannedAt:"2026-09-12T00:00:00.000Z",filesConsidered:0,totalFiles:0,
    limitedSessions:false,tailBytes:65536,maxSessions:50,limit:200,omittedRows:0,readErrors:0,reads:0,
  };
  const calls:Array<{url:string;init?:RequestInit}>=[];
  const originalFetch=globalThis.fetch;
  globalThis.fetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{
    calls.push({url:String(input),init});
    const body=calls.length===1?result:{...result,tailBytes:-1};
    return new Response(JSON.stringify(body),{headers:{"Content-Type":"application/json"}});
  }) as typeof fetch;
  try {
    const source=remoteSource("http://localhost:47881","fixture-token");
    expect(await source.timeline(["/one","/two"])).toEqual(result);
    const request=new URL(calls[0].url);
    expect(request.pathname).toBe("/api/timeline");
    expect(request.searchParams.get("limit")).toBe("200");
    expect(request.searchParams.getAll("project")).toEqual(["/one","/two"]);
    expect((calls[0].init?.headers as Record<string,string>).Authorization).toBe("Bearer fixture-token");
    await expect(source.timeline(undefined,50)).rejects.toThrow("invalid timeline");
    expect(new URL(calls[1].url).searchParams.get("limit")).toBe("50");
  } finally {
    globalThis.fetch=originalFetch;
  }
});
