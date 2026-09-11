import { test, expect } from "bun:test";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadNames, saveName, findSession, sessionId, validateName } from "./names";
import { matchingFiles, renderTui } from "./tui";

test("names persist independently without changing the transcript; empty clears", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jsonl-name-"));
  try {
    const file = join(directory, "session123.jsonl"), store = join(directory, "state", "names.json");
    await writeFile(file, '{}\n');
    expect(await loadNames(store)).toEqual({});
    await saveName(file, " My agent ", store);
    expect((await loadNames(store))[file]).toBe("My agent");
    expect(await readFile(file, "utf8")).toBe('{}\n');
    await saveName(file, "", store);
    expect(await loadNames(store)).toEqual({});
    await writeFile(store, "invalid");
    await expect(saveName(file, "test", store)).rejects.toThrow();
    expect(await readFile(store, "utf8")).toBe("invalid");
  } finally { await rm(directory, {recursive: true, force: true}); }
});
test("ID matching rejects collisions, supports exact path and Unicode names", () => {
  const files = [{path:"/root/abc111.jsonl"},{path:"/root/abc222.jsonl"}];
  expect(findSession(files,"abc111")).toBe(files[0]);
  expect(() => findSession(files,"abc")).toThrow("Ambiguous");
  expect(() => findSession(files,"unknown")).toThrow("No session");
  expect(findSession(files,files[1].path)).toBe(files[1]);
  expect(sessionId("/x/agent-123.jsonl")).toBe("agent-123");
  expect(findSession([{path:"/x/agent-123456789.jsonl"}], "a:12345678").path).toBe("/x/agent-123456789.jsonl");
  expect(validateName("ทดสอบ")).toBe("ทดสอบ");
  expect(() => validateName("bad\x1bname")).toThrow();
  expect(() => validateName("x".repeat(81))).toThrow();
});
test("TUI keeps ID visible alongside alias, filters and bounds rows", () => {
  const file = {path:"/root/session123.jsonl",project:"/jsonl/oracle",session:"session1",tier:"session",class:"hot" as const,age:10,size:1024,type:"user",role:"user"};
  const snapshot = {root:"/root",scannedAt:new Date().toISOString(),tailReads:0, scanMs:1,counts:{hot:1,warm:0,cool:0,dead:1},files:[file,{...file,path:"/root/old.jsonl",class:"dead" as const}],errors:[]};
  const names = {[file.path]:"Lab worker"};
  expect(matchingFiles(snapshot,names,false,"").length).toBe(1);
  expect(matchingFiles(snapshot,names,true,"").length).toBe(2);
  expect(matchingFiles(snapshot,names,true,"worker")[0]).toBe(file);
  const text = renderTui(snapshot,names,[file],0,110,30,"n name · q quit");
  expect(text).toContain("session123");
  expect(text).toContain("Lab worker");
  expect(text).toContain("n name");
  expect(text.split("\n").length).toBeLessThan(30);
  expect(renderTui(snapshot,names,[],0,40,15,"q quit").split("\n").every(line=>line.length<=39)).toBe(true);
});
