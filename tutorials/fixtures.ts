// Synthetic tutorial only. This script never uses ~/.claude/projects.
import { mkdir, writeFile, appendFile, utimes } from "node:fs/promises";
import { resolve } from "node:path";
const root=resolve(import.meta.dir,"../.local/tutorial-projects/-tutorial-demo");
const file=resolve(root,"tutorial-session.jsonl");
const line=(value:unknown)=>JSON.stringify(value)+"\n";
if(process.argv.includes("--append")) {
  await appendFile(file,line({type:"assistant",timestamp:new Date().toISOString(),message:{role:"assistant",content:"A new synthetic message arrived while the live view was open."}}));
  console.log("Appended one synthetic tutorial message.");
} else {
  await mkdir(root,{recursive:true});
  const now=Date.now();
  await writeFile(file,[
    {type:"user",timestamp:new Date(now-6000).toISOString(),message:{role:"user",content:"Check the sample project and summarize the next step."}},
    {type:"assistant",timestamp:new Date(now-4000).toISOString(),message:{role:"assistant",content:[{type:"text",text:"The sample project looks ready. I am checking the fixture tests now."},{type:"tool_use",name:"Bash",input:{command:"bun test"}}]}},
    {type:"user",timestamp:new Date(now-3000).toISOString(),message:{role:"user",content:[{type:"tool_result",content:"3 pass · 0 fail. Synthetic tutorial output."}]}},
    {type:"assistant",timestamp:new Date(now-2000).toISOString(),message:{role:"assistant",content:"All sample tests pass. You can open a session to follow new messages."}},
    {type:"system",subtype:"stop_hook_summary",timestamp:new Date(now-1000).toISOString()},
  ].map(line).join(""));
  const other=resolve(root,"another-session.jsonl");
  await writeFile(other,line({type:"user",timestamp:new Date(now-300000).toISOString(),message:{role:"user",content:"This is a second synthetic session for navigation."}}));
  await utimes(other,new Date(now-300000),new Date(now-300000));
  console.log("Seeded two synthetic sessions in .local/tutorial-projects.");
}
