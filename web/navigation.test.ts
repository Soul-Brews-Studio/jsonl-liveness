import {test,expect} from "bun:test";
import {workspaceURL,claudeReturnURL} from "./navigation";
test("workspace navigation preserves connection and return context without stale detail routes",()=>{
 const url="http://127.0.0.1:47881/?host=localhost:47881&session=id&path=file&returnTo="+encodeURIComponent("http://127.0.0.1:4318/#/sessions/id");
 const next=new URL(workspaceURL(url,"timeline"));
 expect(next.searchParams.get("host")).toBe("localhost:47881");
 expect(next.searchParams.get("returnTo")).toContain("#/sessions/id");
 expect(next.searchParams.has("session")).toBe(false);
 expect(next.searchParams.has("path")).toBe(false);
 expect(next.searchParams.get("view")).toBe("timeline");
 expect(new URL(workspaceURL(next.href,"table")).searchParams.has("view")).toBe(false);
});
test("return link preserves Claude session but rejects foreign origins and credentials",()=>{
 const link=(value:string)=>"http://127.0.0.1:47881/?returnTo="+encodeURIComponent(value);
 expect(claudeReturnURL(link("http://127.0.0.1:4318/#/sessions/abc"))).toBe("http://127.0.0.1:4318/#/sessions/abc");
 for(const value of ["javascript:alert(1)","https://evil.test/#/sessions/abc","http://user:secret@127.0.0.1:4318/#/sessions/abc","http://127.0.0.1:4318/#/unknown"])
  expect(claudeReturnURL(link(value))).toBe("http://127.0.0.1:4318/#/sessions");
});
