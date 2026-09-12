import {fullID, type FileRow} from "./model";

/** Parent IDs come only from the standard session/subagents path structure. */
export function sessionIdentity(file: Pick<FileRow,"path"|"id"|"tier">) {
  const parts=file.path.replaceAll("\\","/").split("/");
  const index=parts.lastIndexOf("subagents");
  const parent=index>0?parts[index-1]:undefined;
  const sessionId=file.tier==="session"?fullID(file):
    parent&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(parent)?parent:null;
  const agentId=["subagent","workflow-agent"].includes(file.tier)?fullID(file):null;
  const workflowId=parts.find((part,i)=>parts[i-1]==="workflows"&&part.startsWith("wf_"))??null;
  return {sessionId,agentId,workflowId};
}
