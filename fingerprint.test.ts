import { test, expect } from "bun:test";
import { mkdtemp, writeFile, readFile, stat, appendFile, rm, symlink, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { FingerprintCache } from "./fingerprint";
import { localSource } from "./source";
import { startServer } from "./server";
import { isFingerprintStale } from "./web/components/HashCheck";

test("stat-only refresh reuses tails; SHA-256 is computed only on demand and cached by revision",async()=>{
  const root=await mkdtemp(join(tmpdir(),"jsonl-hash-"));
  try {
    const path=join(root,"file.jsonl"),store=join(root,"names.json");
    const original='{"type":"user","content":"hello"}\n';await writeFile(path,original);
    const source=localSource(root,undefined,store);
    const first=await source.read();expect(first.tailReads).toBe(1);
    const firstRevision=first.files[0].revision;
    expect(first.files[0].mtimeMs).toBe((await stat(path)).mtimeMs);
    expect(first.files[0].modifiedAt).toBe((await stat(path)).mtime.toISOString());
    expect((await source.read()).tailReads).toBe(0);
    const cache=new FingerprintCache();
    const before=await stat(path),fingerprint=await cache.read(root,path);
    expect(fingerprint.hash).toBe(createHash("sha256").update(original).digest("hex"));
    expect(fingerprint.cached).toBe(false);
    expect((await cache.read(root,path)).cached).toBe(true);
    expect((await cache.read(root,path,true)).cached).toBe(false);
    expect((await stat(path)).mtimeMs).toBe(before.mtimeMs);expect(await readFile(path,"utf8")).toBe(original);
    const replacement='{"type":"user","content":"HELLO"}\n';
    expect(Buffer.byteLength(replacement)).toBe(Buffer.byteLength(original));
    await Bun.sleep(5);await writeFile(path,replacement);await utimes(path,before.atimeMs/1000,before.mtimeMs/1000);
    const rewritten=await source.read();
    expect(rewritten.files[0].mtimeMs).toBe(before.mtimeMs);
    expect(rewritten.files[0].size).toBe(before.size);
    expect(rewritten.files[0].revision).not.toBe(firstRevision);
    expect(rewritten.tailReads).toBe(1);
    const rewrittenFingerprint=await cache.read(root,path);
    expect(rewrittenFingerprint.cached).toBe(false);
    expect(rewrittenFingerprint.hash).not.toBe(fingerprint.hash);
    expect(isFingerprintStale(rewritten.files[0],fingerprint)).toBe(true);
    expect(isFingerprintStale(rewritten.files[0],rewrittenFingerprint)).toBe(false);
    await appendFile(path,'{"type":"assistant"}\n');
    expect((await source.read()).tailReads).toBe(1);
    const changed=await cache.read(root,path);expect(changed.hash).not.toBe(rewrittenFingerprint.hash);expect(changed.cached).toBe(false);
    expect((await source.read()).tailReads).toBe(0);
    await rm(path);expect((await source.read()).files).toHaveLength(0);
  }finally{await rm(root,{recursive:true,force:true});}
});
test("hash endpoint requires auth, validates scan membership and rejects root escape",async()=>{
  const root=await mkdtemp(join(tmpdir(),"jsonl-hash-api-")),outside=await mkdtemp(join(tmpdir(),"jsonl-hash-outside-"));
  try {
    const path=join(root,"file.jsonl"),target=join(outside,"outside.jsonl"),link=join(root,"link.jsonl");
    await writeFile(path,'{}\n');await writeFile(target,'{}\n');await symlink(target,link);
    const running=await startServer({root,port:0,token:"test",namesFile:join(root,"names.json")});
    try {
      const url=(file:string)=>`${running.url}/api/session/fingerprint?path=${encodeURIComponent(file)}`;
      const headers={Authorization:"Bearer test"};
      expect((await fetch(url(path))).status).toBe(401);
      expect((await (await fetch(url(path),{headers})).json()).hash).toHaveLength(64);
      expect((await (await fetch(url(path),{headers})).json()).cached).toBe(true);
      expect((await fetch(url("/etc/passwd"),{headers})).status).toBe(403);
      expect((await fetch(url(link),{headers})).status).toBe(403);
    }finally{running.stop();}
  }finally{await rm(root,{recursive:true,force:true});await rm(outside,{recursive:true,force:true});}
});
