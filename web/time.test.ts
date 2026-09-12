import {test,expect} from "bun:test";
import {rowTime,localTime} from "./model";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {MessagePreview} from "./components/MessagePreview";

test("row timestamps stay relative at every age",()=>{
  const now=Date.parse("2026-09-12T05:00:00Z");
  const at=(age:number)=>new Date(now-age).toISOString();
  expect(rowTime(at(0),now)).toBe("0s ago");
  expect(rowTime(at(2000),now)).toBe("2s ago");
  expect(rowTime(at(299999),now)).toBe("4m ago");
  expect(rowTime(at(300000),now)).toBe("5m ago");
  expect(rowTime(at(900000),now)).toBe("15m ago");
  expect(rowTime(at(259200000),now)).toBe("3d ago");
  expect(rowTime(at(-1000),now)).toBe("in 1s");
  expect(rowTime(null,now)).toBe("Not recorded");
  expect(rowTime("invalid",now)).toBe("Not recorded");
});
test("message preview leaves exact dates to the details view",()=>{
  const timestamp="2026-09-12T05:00:00Z",now=Date.parse(timestamp)+2000;
  const html=renderToStaticMarkup(createElement(MessagePreview,{
    path:"fixture",revision:"1",now,request:async()=>({}),
    summary:{text:"hello",role:"user",timestamp,truncated:false}
  }));
  expect(html).toContain("Message: 2s ago");
  expect(html).toContain('dateTime="'+timestamp+'"');
  expect(html).not.toContain(localTime(timestamp));
});
