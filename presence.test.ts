import { expect, test } from "bun:test";
import { parseProcessTable, PresenceCache } from "./presence";

const FIRST = "11111111-2222-4333-8444-555555555555";
const SECOND = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const CHECKED_AT = "2026-09-12T04:05:06.000Z";

test("parses only explicit session flags on the actual Claude executable", () => {
  const parsed = parseProcessTable([
    `  101 /usr/local/bin/claude claude --session-id ${FIRST}`,
    `  202 claude             /opt/claude --resume ${FIRST}`,
    `  303 claude             claude --resume=${SECOND}`,
    `  404 claude             claude -r ${SECOND}`,
    `  505 zsh                zsh -c 'claude --resume ${FIRST}'`,
    `  606 grep               grep --resume=${FIRST}`,
    `  707 ps                 ps -axo pid,comm,args --resume ${FIRST}`,
    `  808 node               node helper.js --session-id ${FIRST}`,
    `  909 claude-helper      claude-helper --resume ${FIRST}`,
    ` 1001 claude             claude -- "prompt --resume ${FIRST}"`,
  ].join("\n"), CHECKED_AT);

  expect(parsed).toEqual(new Map([
    [FIRST, { state: "open", pids: [101, 202], checkedAt: CHECKED_AT }],
    [SECOND, { state: "open", pids: [303, 404], checkedAt: CHECKED_AT }],
  ]));
});

test("rejects invalid or unsupported IDs and does not invent missing sessions", () => {
  const parsed = parseProcessTable([
    "10 claude claude --resume not-a-uuid",
    "11 claude claude --session-id 11111111-2222-3333-4444",
    `12 claude claude --session-id=${FIRST}`,
    `13 claude claude --resume=${FIRST}suffix`,
    "14 claude claude --resume",
    `15 claude claude --resume '${FIRST} extra'`,
  ].join("\n"), CHECKED_AT);

  expect(parsed.size).toBe(0);
});

test("deduplicates and sorts multiple live PIDs for one session", () => {
  const parsed = parseProcessTable([
    `33 claude claude -r ${FIRST}`,
    `12 claude claude --resume=${FIRST}`,
    `33 claude claude --session-id ${FIRST}`,
  ].join("\n"), CHECKED_AT);

  expect(parsed.get(FIRST)?.pids).toEqual([12, 33]);
});

test("caches successful polls for ten seconds and protects cached values", async () => {
  let now = Date.parse(CHECKED_AT);
  let polls = 0;
  const cache = new PresenceCache({
    now: () => now,
    readProcessTable: async () => {
      polls++;
      return `42 claude claude --resume ${FIRST}`;
    },
  });

  const first = await cache.read();
  first.get(FIRST)!.pids.push(99);
  now += 9_999;
  expect((await cache.read()).get(FIRST)?.pids).toEqual([42]);
  expect(polls).toBe(1);

  now++;
  await cache.read();
  expect(polls).toBe(2);
});

test("shares concurrent polls and caches failures as an empty map", async () => {
  let now = Date.parse(CHECKED_AT);
  let polls = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const cache = new PresenceCache({
    now: () => now,
    readProcessTable: async () => {
      polls++;
      await gate;
      throw new Error("ps unavailable");
    },
  });

  const first = cache.read();
  const second = cache.read();
  release();
  expect((await first).size).toBe(0);
  expect((await second).size).toBe(0);
  expect(polls).toBe(1);

  now += 9_999;
  expect((await cache.read()).size).toBe(0);
  expect(polls).toBe(1);
});


test("forked and conflicting session arguments do not confirm the wrong session",()=>{
  const a="11111111-1111-4111-8111-111111111111",b="22222222-2222-4222-8222-222222222222";
  expect(parseProcessTable(`12 claude claude --resume ${a} --fork-session`).size).toBe(0);
  expect(parseProcessTable(`12 claude claude --resume ${a} --session-id ${b}`).size).toBe(0);
});
