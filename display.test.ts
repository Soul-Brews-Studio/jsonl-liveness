import { expect, test } from "bun:test";
import { ageLabel, shortProject, sizeLabel, render } from "./display";

test("human-readable project, size and age", () => {
  expect(shortProject("/opt/Code/github/com/Soul/Brews/Studio/jsonl/oracle")).toBe("jsonl/oracle");
  expect(sizeLabel(1024)).toBe("1K");
  expect(sizeLabel(1024 ** 2 * 13)).toBe("13.0M");
  expect(ageLabel(142000)).toBe("2m");
});
test("display identifies agents beyond the agent- prefix and bounds watch rows", () => {
  const file = {path:"/root/-jsonl-oracle/subagents/agent-abcdef123.jsonl",project:"/jsonl/oracle",session:"agent-ab",tier:"subagent",class:"hot" as const,age:4000,size:2048,type:"user",role:"user"};
  const result = {root:"/root",scannedAt:"2026-09-11T13:00:00Z",tailReads:0, scanMs:2,counts:{hot:2,warm:0,cool:0,dead:0},files:[file,{...file,path:"/other.jsonl"}],errors:[]};
  const text = render(result,1);
  expect(text).toContain("agent abcdef12");
  expect(text).toContain("jsonl/oracle");
  expect(text).toContain("1 older files hidden");
  expect(text).toContain("not human input");
  expect(text).not.toContain("other");
});
