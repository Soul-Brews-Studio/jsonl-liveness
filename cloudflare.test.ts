import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

test("Cloudflare deployment remains a static UI shell", async () => {
  const config = JSON.parse(await readFile(new URL("./wrangler.jsonc", import.meta.url), "utf8"));
  const worker = await readFile(new URL("./cloudflare-worker.ts", import.meta.url), "utf8");
  const build = await readFile(new URL("./scripts/build-cloudflare.ts", import.meta.url), "utf8");
  expect(config.assets).toEqual({directory:"./dist", binding:"ASSETS"});
  expect(config.main).toBe("./cloudflare-worker.ts");
  expect(worker).toContain("env.ASSETS.fetch(request)");
  expect(worker).toContain('new URL("/index.html", request.url)');
  expect(worker).not.toContain("fetch(`");
  expect(build).toContain('"index.html"');
  expect(build).toContain('"style.css"');
  expect(build).toContain('"main.js"');
});
