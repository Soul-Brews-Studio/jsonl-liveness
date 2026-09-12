import { expect, test } from "bun:test";
import type { TimelineRow } from "./timeline";
import { matchingTimelineRows, renderTuiTimeline } from "./tui-timeline";

const rows: TimelineRow[] = [
  {id:"human",path:"/projects/alpha/main.jsonl",sessionId:"main-session",name:"Lead",project:"/projects/alpha",tier:"session",timestamp:"2026-09-12T03:04:05Z",kind:"message",role:"user",title:"Human",text:"first line\nsecond line",truncated:false},
  {id:"output",path:"/projects/beta/agent.jsonl",sessionId:"agent-123",name:null,project:"/projects/beta",tier:"subagent",timestamp:"2026-09-12T03:05:06Z",kind:"message",role:"assistant",title:"Assistant",text:"answer text",truncated:false},
  {id:"tool",path:"/projects/alpha/tool.jsonl",sessionId:"tool-session",name:null,project:"/projects/alpha",tier:"workflow-agent",timestamp:null,kind:"tool-result",role:"user",title:"Tool result",text:"tool output",truncated:false},
];

const allEvents = new Set(["human", "output", "tools"]);
const allSources = new Set(["main", "subagents"]);

test("matchingTimelineRows composes event, source, project, and text filters", () => {
  expect(matchingTimelineRows(rows, allEvents, allSources, "", "").map(row => row.id)).toEqual(["human", "output", "tool"]);
  expect(matchingTimelineRows(rows, new Set(["human"]), new Set(["main"]), "/projects/alpha", "lead").map(row => row.id)).toEqual(["human"]);
  expect(matchingTimelineRows(rows, new Set(["output", "tools"]), new Set(["subagents"]), "", "AGENT-123").map(row => row.id)).toEqual(["output"]);
  expect(matchingTimelineRows(rows, new Set(["tools"]), new Set(["subagents"]), "/projects/alpha", "tool output").map(row => row.id)).toEqual(["tool"]);
  expect(matchingTimelineRows(rows, new Set(), allSources, "", "")).toEqual([]);
  expect(rows.map(row => row.id)).toEqual(["human", "output", "tool"]);
});

test("renderTuiTimeline renders bounded three-line rows with metadata and multiline preview", () => {
  const text = renderTuiTimeline({rows,selected:0,width:96,height:16,footer:"Enter detail · q quit",paused:false,following:true,eventGroups:allEvents,sourceGroups:allSources,project:"",limit:50,loading:false,error:""});
  const plain = text.replace(/\x1b\[[0-9;]*m/g, "");
  expect(plain).toContain("times local");
  expect(plain).toContain("1 [x] Human · 2 [x] AI · 3 [x] Tools · 4 [x] Main · 5 [x] Subagents");
  expect(plain).toContain(`${new Date(rows[0].timestamp!).getFullYear()}-`);
  expect(plain).toContain("· alpha · main-session · HUMAN");
  expect(plain).toContain("Human — first line");
  expect(plain).toContain("second line");
  expect(plain).toContain("time unknown · alpha · tool-session · TOOLS");
  expect(plain).toContain("Enter opens detail");
  expect(text.split("\n").length).toBeLessThan(16);
  for (const line of plain.split("\n")) expect(Array.from(line).length).toBeLessThan(96);
});

test("rendering neutralizes transcript control codes and labels clipped content", () => {
  const dangerous: TimelineRow = {...rows[0],project:"/projects/\u001b[31malpha",title:"wipe\u001b[2J",text:"long \u009b payload ".repeat(30),truncated:true};
  const text = renderTuiTimeline({rows:[dangerous],selected:0,width:48,height:12,footer:"footer\u001b[H",paused:true,following:false,eventGroups:allEvents,sourceGroups:allSources,project:"",limit:20,loading:false,error:""});
  const generatedAnsi = /\x1b\[38;2;\d+;\d+;\d+m/g;
  const plain = text.replace(generatedAnsi, "");
  expect(plain).not.toContain("\u001b");
  expect(plain).not.toContain("\u009b");
  expect(plain).toContain("?[31m");
  expect(plain).toContain("… truncated → Enter detail");
  expect(text.match(generatedAnsi)?.length).toBe(2);
  expect(text.split("\n").length).toBeLessThan(12);
  for (const line of plain.split("\n")) expect(Array.from(line).length).toBeLessThan(48);
});

test("project colors are label-derived and stable across order and selection", () => {
  const render = (ordered: TimelineRow[], selected: number) => renderTuiTimeline({rows:ordered,selected,width:100,height:14,footer:"q quit",paused:false,following:true,eventGroups:allEvents,sourceGroups:allSources,project:"",limit:50,loading:false,error:""});
  const colorFor = (text: string, project: string) => {
    const escaped = project.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return text.match(new RegExp(`(\\x1b\\[38;2;[0-9;]+m)${escaped}`))?.[1];
  };
  const first = render(rows.slice(0, 2), 0);
  const reordered = render(rows.slice(0, 2).toReversed(), 1);
  expect(colorFor(first, "alpha")).toBe(colorFor(reordered, "alpha"));
  expect(colorFor(first, "beta")).not.toBe(colorFor(first, "alpha"));
});

test("renderer trusts controller-filtered rows and wraps a long controller footer", () => {
  const text = renderTuiTimeline({rows:[rows[1]],selected:0,width:110,height:14,footer:"Enter detail · ↑↓/jk move · / find · 1 [x] Human · 2 [x] AI · 3 [x] Tools · 4 [x] Main · 5 [x] Subagents · p pause · f follow · q quit",paused:false,following:true,eventGroups:new Set(["human"]),sourceGroups:new Set(["main"]),project:"None",limit:50,loading:false,error:""});
  const plain = text.replace(/\x1b\[[0-9;]*m/g, "");
  expect(plain).toContain("Project None");
  expect(plain).toContain("agent-123");
  expect(plain).toContain("p pause · f follow · q quit");
  expect(plain.split("\n").length).toBeLessThan(14);
});
