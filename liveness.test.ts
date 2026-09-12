import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, utimes, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classify, tier, projectName, lastCompleteLine, scan } from "./liveness";

test("all path tiers", () => {
  expect(tier("-repo/id.jsonl")).toBe("session");
  expect(tier("-repo/id/subagents/agent-a.jsonl")).toBe("subagent");
  expect(tier("-repo/id/subagents/workflows/wf_a/journal.jsonl")).toBe("workflow-journal");
  expect(tier("-repo/id/subagents/workflows/wf_a/agent-a.jsonl")).toBe("workflow-agent");
  expect(projectName("-home-user-repo/id.jsonl")).toBe("/home/user/repo");
});
test("exact class boundaries", () => {
  for (const [age, expected] of [[0,"hot"],[119999,"hot"],[120000,"warm"],[899999,"warm"],[900000,"cool"],[7199999,"cool"],[7200000,"dead"]] as const) expect(classify(age)).toBe(expected);
  expect(classify(10, {hot:10,warm:20,cool:30})).toBe("warm");
});
test("holds back partial lines, including long suffixes and split UTF-8", async () => {
  const root = await mkdtemp(join(tmpdir(), "jsonl-tail-"));
  const path = join(root, "fixture.jsonl");
  try {
    for (const [content, expected] of [
      ["", undefined], ['{"type":"partial"}', undefined],
      ['{"type":"user"}\n{"type":"assistant"}', '{"type":"user"}'],
      ['{"type":"user"}\n' + "x".repeat(9000), '{"type":"user"}'],
      ["old\n" + "ก".repeat(3000) + "\n", "ก".repeat(3000)],
      ["old\nlast\r\n", "last"], ["one\n", "one"],
    ] as const) {
      await writeFile(path, content);
      expect(await lastCompleteLine(path)).toBe(expected);
    }
  } finally { await rm(root, {recursive:true, force:true}); }
});
test("fixture turns hot when touched and reports tail metadata", async () => {
  const root = await mkdtemp(join(tmpdir(), "jsonl-live-"));
  try {
    await mkdir(join(root, "-fixture-project"));
    const path = join(root, "-fixture-project", "session1.jsonl");
    await writeFile(path, '{"type":"assistant","message":{"role":"assistant"}}\n{"type":"partial"}');
    const now = Date.now();
    const old = new Date(now - 8_000_000);
    await utimes(path, old, old);
    expect((await scan(root, undefined, now)).files[0].class).toBe("dead");
    await utimes(path, new Date(now), new Date(now));
    const result = await scan(root, undefined, now);
    expect(result.files[0].class).toBe("hot");
    expect(result.files[0].type).toBe("assistant");
    expect(result.files[0].role).toBe("assistant");
    expect(result.errors).toEqual([]);
  } finally { await rm(root, {recursive:true, force:true}); }
});

test("recorded cwd preserves punctuation and unchanged scans reuse the head", async () => {
  const root = await mkdtemp(join(tmpdir(), "jsonl-cwd-"));
  try {
    const directory = join(root, "-opt-Code-github-com-nat-build-with-oracle-12sep-sat2026-oracle");
    await mkdir(directory);
    const path = join(directory, "session.jsonl");
    const cwd = "/opt/Code/github.com/nat-build-with-oracle/12sep-sat2026-oracle";
    await writeFile(path, '{"type":"metadata"}\n' + JSON.stringify({type:"user",cwd}) + '\n{"cwd":"/partial"}');
    const cache = new Map();
    const first = await scan(root, undefined, Date.now(), cache);
    expect(first.files[0].project).toBe(cwd);
    expect(first.files[0].projectSource).toBe("cwd");
    expect((await scan(root, undefined, Date.now(), cache)).tailReads).toBe(0);
    await writeFile(path, '{"cwd":"/partial"}');
    const partial = await scan(root, undefined, Date.now(), cache);
    expect(partial.files[0].projectSource).toBe("decoded");
    expect(partial.files[0].project).not.toBe("/partial");
    await writeFile(path, JSON.stringify({padding:"x".repeat(65536),cwd})+'\n');
    expect((await scan(root)).files[0].projectSource).toBe("decoded");
  } finally { await rm(root, {recursive:true,force:true}); }
});
