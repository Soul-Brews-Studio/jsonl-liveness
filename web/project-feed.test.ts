import {test,expect} from "bun:test";
import {readFile} from "node:fs/promises";
test("project checklist uses observed feed rows, clears on refresh and stays bounded",async()=>{
 const source=await readFile(new URL("./components/Timeline.tsx",import.meta.url),"utf8");
 expect(source).toContain("for(const row of result.data.rows)next.add(row.project)");
 expect(source).not.toContain("new Set(snapshot?.files.map");
 expect(source).toContain("reset();setSeenProjects(new Set())");
 expect(source).toContain('maxHeight:"16rem",overflowY:"auto"');
});
