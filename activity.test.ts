import { test, expect } from "bun:test";
import { mkdtemp, writeFile, appendFile, utimes, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localSource } from "./source";

test("touching an old session never creates a new message; append reorders messages, partial held, cache reused", async()=>{
  const root=await mkdtemp(join(tmpdir(),"jsonl-activity-"));
  try {
    const older=join(root,"older.jsonl"), newer=join(root,"newer.jsonl");
    await writeFile(older,JSON.stringify({type:"assistant",timestamp:"2026-09-01T00:00:00Z",message:{content:"Old answer"}})+"\n");
    await writeFile(newer,JSON.stringify({type:"assistant",timestamp:"2026-09-02T00:00:00Z",message:{content:"New answer"}})+"\n");
    const source=localSource(root,undefined,join(root,"names.json"));
    const first=await source.read();
    expect(first.files[0].id).toBe("newer");
    expect(first.messageReads).toBe(2);
    expect((await source.read()).messageReads).toBe(0);
    await utimes(older,new Date(),new Date(Date.now()+1000));
    const touched=await source.read();
    expect(touched.files[0].id).toBe("newer");
    expect(touched.files.find(f=>f.id==="older")?.message?.timestamp).toBe("2026-09-01T00:00:00.000Z");
    expect(touched.files.find(f=>f.id==="older")?.class).toBe("hot");
    expect(touched.messageReads).toBe(1);
    await appendFile(older,JSON.stringify({type:"assistant",timestamp:"2026-09-03T00:00:00Z",message:{content:"Partial new answer"}}));
    expect((await source.read()).files[0].id).toBe("newer");
    await appendFile(older,"\n");
    const changed=await source.read();
    expect(changed.files[0].id).toBe("older");
    expect(changed.files[0].message?.text).toBe("Partial new answer");
    expect(changed.files[0].presence?.state).toBe("unknown");
  } finally {await rm(root,{recursive:true,force:true});}
});
