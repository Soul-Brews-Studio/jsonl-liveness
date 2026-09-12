import { test, expect } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, stat, utimes, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "./server";
import { normalizeHost } from "./host";
import { remoteSource } from "./source";

async function fixture(run: (root: string, file: string, store: string) => Promise<void>) {
  const temp = await mkdtemp(join(tmpdir(), "jsonl-api-"));
  const root = join(temp, "projects"), project = join(root, "-fixture-oracle");
  await mkdir(project, {recursive:true});
  const file = join(project, "session123.jsonl");
  await writeFile(file, '{"type":"assistant","message":{"role":"assistant"}}\n{"type":"partial"}');
  try { await run(root, file, join(temp, "names.json")); }
  finally { await rm(temp, {recursive:true, force:true}); }
}
test("host routing normalizes HTTP/HTTPS, rejects credentials and non-origin URLs", () => {
  expect(normalizeHost("localhost:47881")).toBe("http://localhost:47881");
  expect(normalizeHost("https://example.com/")).toBe("https://example.com");
  for (const value of ["file:///tmp/a", "https://user:secret@example.com", "http://localhost/path", "http://localhost?token=x", "http://localhost#x", ""]) expect(() => normalizeHost(value)).toThrow();
});
test("real HTTP snapshots and aliases preserve transcript and remain after restart", async () => {
  await fixture(async (root,file,store) => {
    const bytes = await readFile(file), before = await stat(file);
    let running = await startServer({root,port:0,namesFile:store});
    try {
      const remote = remoteSource(running.url);
      const snapshot = await remote.read();
      expect(snapshot.files[0].id).toBe("session123");
      expect(snapshot.files[0].type).toBe("assistant");
      await remote.rename(file,"From browser");
      expect((await remote.read()).files[0].name).toBe("From browser");
      await expect(remote.rename("/etc/passwd", "no")).rejects.toThrow("400");
      expect(await readFile(file)).toEqual(bytes);
      expect((await stat(file)).mtimeMs).toBe(before.mtimeMs);
      running.stop();
      running = await startServer({root,port:0,namesFile:store});
      expect((await remoteSource(running.url).read()).files[0].name).toBe("From browser");
      const old = new Date(Date.now()-8_000_000);
      await utimes(file,old,old);
      await running.service.refresh();
      expect((await remoteSource(running.url).read()).files[0].class).toBe("dead");
      await utimes(file,new Date(),new Date());
      await running.service.refresh();
      expect((await remoteSource(running.url).read()).files[0].class).toBe("hot");
    } finally { running.stop(); }
  });
});
test("backend enforces origin, token, content type and non-loopback binding", async () => {
  await fixture(async (root,file,store) => {
    await expect(startServer({root,listen:"0.0.0.0",port:0,namesFile:store})).rejects.toThrow("requires JSONL_TOKEN");
    const running = await startServer({root,port:0,namesFile:store,token:"fixture-token",allowedOrigins:["https://my-ui.example"]});
    try {
      expect((await fetch(`${running.url}/api/snapshot`)).status).toBe(401);
      expect((await fetch(`${running.url}/api/snapshot`,{headers:{Origin:"https://evil.example",Authorization:"Bearer fixture-token"}})).status).toBe(403);
      const preflight = await fetch(`${running.url}/api/snapshot`,{method:"OPTIONS",headers:{Origin:"https://my-ui.example","Access-Control-Request-Private-Network":"true"}});
      expect(preflight.status).toBe(204);
      expect(preflight.headers.get("access-control-allow-origin")).toBe("https://my-ui.example");
      expect(preflight.headers.get("access-control-allow-private-network")).toBe("true");
      expect((await remoteSource(running.url,"fixture-token").read()).files.length).toBe(1);
      expect((await fetch(`${running.url}/api/names`,{method:"PUT",headers:{Authorization:"Bearer fixture-token"},body:JSON.stringify({path:file,name:"x"})})).status).toBe(415);
      expect((await fetch(`${running.url}/api/names`,{method:"PUT",headers:{Authorization:"Bearer fixture-token","Content-Type":"application/json"},body:"{"})).status).toBe(400);
      expect((await fetch(`${running.url}/api/unknown`,{headers:{Authorization:"Bearer fixture-token"}})).status).toBe(404);
    } finally { running.stop(); }
  });
});
test("SSE sends initial snapshot and later name changes", async () => {
  await fixture(async (root,file,store) => {
    const running = await startServer({root,port:0,namesFile:store});
    const controller = new AbortController();
    try {
      const response = await fetch(`${running.url}/api/events`,{signal:controller.signal});
      expect(response.headers.get("content-type")).toBe("text/event-stream");
      const reader = response.body!.getReader();
      const first = new TextDecoder().decode((await reader.read()).value);
      expect(first).toContain("event: snapshot");
      expect(first).toContain("session123");
      await running.service.rename(file,"SSE name");
      const next = await Promise.race([reader.read(), Bun.sleep(4000).then(()=>{throw new Error("SSE timeout");})]);
      expect(new TextDecoder().decode(next.value)).toContain("SSE name");
      await reader.cancel();
    } finally { controller.abort(); running.stop(); }
  });
});

test("serializes concurrent name writes and isolates failing subscribers", async () => {
  await fixture(async (root,file,store) => {
    const second = join(root, "second.jsonl");
    await writeFile(second, '{}\n');
    const running = await startServer({root,port:0,namesFile:store});
    try {
      running.service.subscribe(() => { throw new Error("broken subscriber"); });
      await Promise.all([running.service.rename(file,"first"),running.service.rename(second,"second")]);
      const snapshot = await remoteSource(running.url).read();
      expect(snapshot.files.find(row=>row.path===file)?.name).toBe("first");
      expect(snapshot.files.find(row=>row.path===second)?.name).toBe("second");
      await writeFile(store,"corrupt");
      await expect(running.service.refresh()).rejects.toThrow();
      expect((await fetch(`${running.url}/api/health`)).status).toBe(503);
      expect((await fetch(`${running.url}/api/snapshot`)).status).toBe(503);
    } finally { running.stop(); }
  });
});

test("serves the browser bundle and rejects a shell without its JavaScript", async () => {
  await fixture(async (root,_file,store) => {
    const running = await startServer({root,port:0,namesFile:store});
    try {
      const html = await fetch(running.url);
      expect(html.status).toBe(200);
      expect(await html.text()).toContain('src="/main.js"');
      const js = await fetch(`${running.url}/main.js`);
      expect(js.status).toBe(200);
      expect(js.headers.get("content-type")).toContain("javascript");
      expect(await js.text()).toContain("/api/snapshot");
      expect((await fetch(`${running.url}/style.css`)).status).toBe(200);
      expect((await fetch(`${running.url}/.local/names.json`)).status).toBe(404);
    } finally { running.stop(); }
    const noWeb = await startServer({root,port:0,namesFile:store,webDirectory:join(root,"missing-web")});
    try { expect((await fetch(noWeb.url)).status).toBe(503); }
    finally { noWeb.stop(); }
  });
});

test("timeline API is authenticated, bounded, cached, project-filtered and read-only", async () => {
  await fixture(async (root,file,store) => {
    await writeFile(file, JSON.stringify({type:"assistant",timestamp:"2026-09-12T01:00:00Z",content:"First line\nSecond line"})+"\n");
    const before = await stat(file), bytes = await readFile(file);
    const running = await startServer({root,port:0,namesFile:store,token:"timeline-token"});
    const headers = {Authorization:"Bearer timeline-token"};
    try {
      expect((await fetch(`${running.url}/api/timeline`)).status).toBe(401);
      expect((await fetch(`${running.url}/api/timeline`,{headers:{...headers,Origin:"https://evil.example"}})).status).toBe(403);
      const result = await fetch(`${running.url}/api/timeline`,{headers});
      expect(result.status).toBe(200);
      expect(result.headers.get("cache-control")).toBe("no-store");
      const timeline = await result.json();
      expect(timeline.rows).toHaveLength(1);
      expect(timeline.rows[0].text).toBe("First line\nSecond line");
      expect(timeline.rows[0].sessionId).toBe("session123");
      expect(timeline.reads).toBe(1);
      expect((await (await fetch(`${running.url}/api/timeline?limit=20`,{headers})).json()).limit).toBe(20);
      expect((await fetch(`${running.url}/api/timeline?limit=-1`,{headers})).status).toBe(400);
      expect((await fetch(`${running.url}/api/timeline?limit=100000`,{headers})).status).toBe(400);
      expect((await (await fetch(`${running.url}/api/timeline`,{headers})).json()).reads).toBe(0);
      const project = encodeURIComponent(timeline.rows[0].project);
      expect((await (await fetch(`${running.url}/api/timeline?project=${project}`,{headers})).json()).rows).toHaveLength(1);
      expect((await (await fetch(`${running.url}/api/timeline?project=${project}-not-exact`,{headers})).json()).rows).toHaveLength(0);
      expect((await fetch(`${running.url}/api/timeline?project=${"x".repeat(4097)}`,{headers})).status).toBe(400);
      expect(await readFile(file)).toEqual(bytes);
      expect((await stat(file)).mtimeMs).toBe(before.mtimeMs);
      await writeFile(store,"corrupt");
      await expect(running.service.refresh()).rejects.toThrow();
      expect((await fetch(`${running.url}/api/timeline`,{headers})).status).toBe(503);
    } finally { running.stop(); }
  });
});
