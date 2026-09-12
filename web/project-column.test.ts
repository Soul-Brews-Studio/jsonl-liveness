import {test,expect} from "bun:test";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {SessionList} from "./components/SessionList";

test("duplicate project column starts hidden with an unchecked opt-in",()=>{
  const html=renderToStaticMarkup(createElement(SessionList,{
    selected:"",onSelect:()=>{},paused:false,busy:false,onPause:()=>{},
    onRefresh:()=>{},table:true,request:async()=>({})
  }));
  expect(html).toContain("Project / session ID");
  expect(html).toContain("Show project column");
  expect(html).not.toContain('>Project</th>');
  expect(html).not.toContain('checked=""');
});
