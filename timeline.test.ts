import { expect, test } from "bun:test";
import { appendFile, mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localSource, type Snapshot } from "./source";
import { TimelineCache } from "./timeline";

async function fixture(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "jsonl-timeline-"));
  try { await run(root); }
  finally { await rm(root, {recursive: true, force: true}); }
}

function line(value: unknown) {
  return JSON.stringify(value) + "\n";
}

async function snapshot(root: string): Promise<Snapshot> {
  return localSource(root, undefined, join(root, "names.json")).read();
}

test("timeline combines complete events across sessions by recorded time, with stable unique IDs and inert text", async () => {
  await fixture(async root => {
    const project = join(root, "-fixture-project");
    await mkdir(project);
    const first = join(project, "same.jsonl");
    const secondDir = join(project, "subagents");
    await mkdir(secondDir);
    const second = join(secondDir, "same.jsonl");
    await writeFile(first, [
      {type: "user", timestamp: "2026-09-11T10:00:00Z", message: {role: "user", content: "question"}},
      {type: "assistant", timestamp: "2026-09-11T10:03:00Z", message: {role: "assistant", content: [
        {type: "text", text: "<img src=x onerror=alert(1)>"},
        {type: "tool_use", name: "Read", input: {path: "README.md"}},
      ]}},
    ].map(line).join(""));
    await writeFile(second, [
      {type: "assistant", timestamp: "2026-09-11T10:02:00Z", message: {role: "assistant", content: "other answer"}},
      {type: "system", subtype: "metadata", text: "metadata event"},
    ].map(line).join(""));
    const source = localSource(root, undefined, join(root, "names.json"));
    const current = await source.read();
    current.files.find(file => file.path === first)!.name = "Fresh alias";
    const result = await new TimelineCache(root).read(current);

    expect(result.rows.map(row => row.timestamp)).toEqual([
      "2026-09-11T10:03:00.000Z",
      "2026-09-11T10:03:00.000Z",
      "2026-09-11T10:02:00.000Z",
      "2026-09-11T10:00:00.000Z",
      null,
    ]);
    expect(new Set(result.rows.map(row => row.id)).size).toBe(result.rows.length);
    expect(result.rows.filter(row => row.sessionId === "same").length).toBe(result.rows.length);
    expect(result.rows.find(row => row.text.includes("<img"))?.text).toBe("<img src=x onerror=alert(1)>");
    expect(result.rows.find(row => row.path === first)?.name).toBe("Fresh alias");
    expect(result.rows.map(row => row.kind)).toContain("tool-use");
    expect(result.tailBytes).toBe(65536);
    expect(result.reads).toBe(2);
  });
});

test("touches do not reorder events; unchanged snapshots reuse cache and fresh metadata", async () => {
  await fixture(async root => {
    const older = join(root, "older.jsonl");
    const newer = join(root, "newer.jsonl");
    await writeFile(older, line({type: "user", timestamp: "2026-09-11T09:00:00Z", content: "old"}));
    await writeFile(newer, line({type: "assistant", timestamp: "2026-09-11T10:00:00Z", content: "new"}));
    const cache = new TimelineCache(root);
    const first = await snapshot(root);
    expect((await cache.read(first)).rows.map(row => row.text)).toEqual(["new", "old"]);
    const unchanged = await cache.read({...first, scannedAt: "2026-09-12T00:00:00.000Z",
      files: first.files.map(file => file.path === newer
        ? {...file, name: "Renamed", project: "fresh-project"}
        : {...file})});
    expect(unchanged.reads).toBe(0);
    expect(unchanged.rows[0].name).toBe("Renamed");
    expect(unchanged.rows[0].project).toBe("fresh-project");

    await utimes(older, new Date(), new Date(Date.now() + 1000));
    const touched = await snapshot(root);
    const afterTouch = await cache.read(touched);
    expect(afterTouch.reads).toBe(1);
    expect(afterTouch.rows.map(row => row.text)).toEqual(["new", "old"]);
  });
});

test("repeated snapshots and append with a partial record stay duplicate-free and cache failures", async () => {
  await fixture(async root => {
    const file = join(root, "session.jsonl");
    await writeFile(file, line({type: "user", timestamp: "2026-09-11T10:00:00Z", content: "complete"}));
    const cache = new TimelineCache(root);
    const initial = await snapshot(root);
    const first = await cache.read(initial);
    expect(first.rows.map(row => row.text)).toEqual(["complete"]);
    expect((await cache.read(initial)).reads).toBe(0);

    await appendFile(file, JSON.stringify({type: "assistant", timestamp: "2026-09-11T10:01:00Z", content: "held"}));
    const partial = await cache.read(await snapshot(root));
    expect(partial.rows.map(row => row.text)).toEqual(["complete"]);
    expect(new Set(partial.rows.map(row => row.id)).size).toBe(partial.rows.length);
    await appendFile(file, "\n");
    const committed = await cache.read(await snapshot(root));
    expect(committed.rows.map(row => row.text)).toEqual(["held", "complete"]);
    expect(new Set(committed.rows.map(row => row.id)).size).toBe(2);

    const missing = join(root, "missing.jsonl");
    const broken = {...(await snapshot(root)), files: [{...(await snapshot(root)).files[0], path: missing, revision: "missing:1"}]};
    expect((await cache.read(broken)).readErrors).toBe(1);
    const cachedFailure = await cache.read(broken);
    expect(cachedFailure.readErrors).toBe(1);
    expect(cachedFailure.reads).toBe(0);
  });
});

test("project filtering is exact and session, row, and text caps are reported", async () => {
  await fixture(async root => {
    const files: Snapshot["files"] = [];
    for (let index = 0; index < 52; index++) {
      const directory = join(root, index === 51 ? "-fixture-project-extra" : "-fixture-project");
      await mkdir(directory, {recursive: true});
      const path = join(directory, `${String(index).padStart(2, "0")}.jsonl`);
      const records = Array.from({length: 5}, (_, event) => ({
        type: "assistant",
        timestamp: new Date(Date.UTC(2026, 8, 11, 10, index, event)).toISOString(),
        content: index === 50 && event === 4 ? "x".repeat(4000) : `${index}:${event}`,
      }));
      await writeFile(path, records.map(line).join(""));
    }
    const current = await snapshot(root);
    files.push(...current.files);
    const cache = new TimelineCache(root);
    const result = await cache.read({...current, files}, "/fixture/project");
    expect(result.totalFiles).toBe(51);
    expect(result.filesConsidered).toBe(50);
    expect(result.limitedSessions).toBe(true);
    expect(result.maxSessions).toBe(50);
    expect(result.limit).toBe(200);
    expect(result.rows).toHaveLength(200);
    expect(result.omittedRows).toBe(50);
    expect(result.rows.every(row => row.project === "/fixture/project")).toBe(true);
    expect(result.rows.some(row => row.project === "/fixture/project/extra")).toBe(false);
    expect(result.rows.find(row => row.text.startsWith("x"))?.text).toHaveLength(3000);
    expect(result.rows.find(row => row.text.startsWith("x"))?.truncated).toBe(true);
  });
});

test("timeline accepts smaller row windows without extra reads and rejects unsafe limits",async()=>{
  await fixture(async root=>{
    const file=join(root,"session.jsonl");
    await writeFile(file,Array.from({length:100},(_,n)=>line({type:"user",timestamp:new Date(1000000+n*1000).toISOString(),content:String(n)})).join(""));
    const current=await snapshot(root),cache=new TimelineCache(root);
    for(const limit of [20,50,100]){
      const result=await cache.read(current,undefined,limit);
      expect(result.rows).toHaveLength(limit);expect(result.limit).toBe(limit);
      expect(result.reads).toBe(limit===20?1:0);
    }
    await expect(cache.read(current,undefined,0)).rejects.toThrow("limit");
    await expect(cache.read(current,undefined,201)).rejects.toThrow("limit");
  });
});

test("project multi-selection supports one, several, none and newly arriving projects",async()=>{
  await fixture(async root=>{
    for(const name of ["a","b","c"]){
      await mkdir(join(root,"-"+name));
      await writeFile(join(root,"-"+name,"session.jsonl"),line({type:"user",timestamp:"2026-09-12T00:00:00Z",content:name}));
    }
    const current=await snapshot(root),cache=new TimelineCache(root);
    expect((await cache.read(current,["/a"])).rows.map(row=>row.project)).toEqual(["/a"]);
    expect(new Set((await cache.read(current,["/a","/c"])).rows.map(row=>row.project))).toEqual(new Set(["/a","/c"]));
    expect((await cache.read(current,[])).rows).toEqual([]);
    await mkdir(join(root,"-new"));
    await writeFile(join(root,"-new","session.jsonl"),line({type:"user",timestamp:"2026-09-12T01:00:00Z",content:"new"}));
    const updated=await snapshot(root);
    expect((await cache.read(updated)).rows.some(row=>row.project==="/new")).toBe(true);
    expect((await cache.read(updated,["/a","/c"])).rows.some(row=>row.project==="/new")).toBe(false);
  });
});
