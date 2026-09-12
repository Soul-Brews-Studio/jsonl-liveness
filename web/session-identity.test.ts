import {test,expect} from "bun:test";
import {sessionIdentity} from "./session-identity";
const id="b3d47b3d-1498-4694-b444-28da4d6434c5";
test("separates parent session, agent and workflow without guessing names",()=>{
 expect(sessionIdentity({path:`/projects/repo/${id}.jsonl`,tier:"session"})).toEqual({sessionId:id,agentId:null,workflowId:null});
 expect(sessionIdentity({path:`/projects/repo/${id}/subagents/workflows/wf_demo/agent-a.jsonl`,tier:"workflow-agent"})).toEqual({sessionId:id,agentId:"agent-a",workflowId:"wf_demo"});
 expect(sessionIdentity({path:`/projects/repo/${id}/subagents/agent-b.jsonl`,tier:"subagent"})).toEqual({sessionId:id,agentId:"agent-b",workflowId:null});
 expect(sessionIdentity({path:"/repo/subagents/agent-b.jsonl",tier:"subagent"}).sessionId).toBeNull();
 expect(sessionIdentity({path:`/projects/repo/${id}/subagents/workflows/wf_demo/journal.jsonl`,tier:"workflow-journal"}).agentId).toBeNull();
});
