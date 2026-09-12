import {test,expect} from "bun:test";
import {projectColor} from "./project-color";
test("matching project names share a stable color across paths and sessions",()=>{
 expect(projectColor("/a/neo-oracle")).toBe(projectColor("/b/neo-oracle/"));
 expect(projectColor("NEO-ORACLE")).toBe(projectColor("neo-oracle"));
 expect(projectColor("neo-oracle")).not.toBe(projectColor("12sep-sat2026-oracle"));
 expect(projectColor("neo-oracle")).toBe(projectColor("neo-oracle"));
 expect(projectColor("")).toMatch(/^project-color-[0-7]$/);
});
test("project colors remain readable on every theme and arrival highlight",async()=>{
 const css=await Bun.file(new URL("./theme.css",import.meta.url)).text();
 const luminance=(hex:string)=>{
  const c=hex.match(/\w\w/g)!.map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
  return c[0]*.2126+c[1]*.7152+c[2]*.0722;
 };
 for(const theme of ["dark","paper","vangogh"]){
  const tokens:Record<string,string>={};
  for(const match of css.matchAll(/(:root(?:\[data-theme=(\w+)\])?)\s*\{([^}]+)\}/g)){
   if(match[2]&&match[2]!==theme)continue;
   for(const token of match[3].matchAll(/--([\w-]+):\s*#([\da-f]{6})/g))tokens[token[1]]=token[2];
  }
  for(let i=0;i<8;i++)for(const surface of ["canvas","surface","panel","selected"]){
   const a=luminance(tokens[`project-${i}`]),b=luminance(tokens[surface]);
   expect((Math.max(a,b)+.05)/(Math.min(a,b)+.05)).toBeGreaterThanOrEqual(4.5);
  }
 }
});
