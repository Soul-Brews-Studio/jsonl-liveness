import { copyFile, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const dist = join(root, "dist");
const files = [
  [join(root, "web", "index.html"), join(dist, "index.html")],
  [join(root, "web", "style.css"), join(dist, "style.css")],
  [join(root, ".local", "web-build", "main.js"), join(dist, "main.js")],
] as const;

await rm(dist, {recursive: true, force: true});
await mkdir(dist, {recursive: true});
for (const [from, to] of files) await copyFile(from, to);
console.log(`Cloudflare static assets ready: ${files.map(([, to]) => to.slice(dist.length + 1)).join(", ")}`);
