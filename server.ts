import { resolve } from "node:path";
import { timingSafeEqual } from "node:crypto";
import { LivenessService } from "./service";
import { normalizeHost } from "./host";
import { DETAIL_BYTES, MAX_DETAIL_BYTES } from "./details";
import type { Thresholds } from "./liveness";

export interface ServerOptions {
  root: string;
  port?: number;
  listen?: string;
  token?: string;
  allowedOrigins?: string[];
  thresholds?: Thresholds;
  namesFile?: string;
  webDirectory?: string;
}
const loopback = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
function validToken(received: string | null, expected?: string): boolean {
  if (!expected) return true;
  const actual = Buffer.from(received ?? "");
  const wanted = Buffer.from(`Bearer ${expected}`);
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}

export async function startServer(options: ServerOptions) {
  const listen = options.listen ?? "127.0.0.1";
  if (!loopback.has(listen) && !options.token) throw new Error("Non-loopback binding requires JSONL_TOKEN");
  const allowedOrigins = new Set((options.allowedOrigins ?? []).map(normalizeHost));
  const webDirectory = options.webDirectory ?? resolve(import.meta.dir, "web");
  let bundle: Blob | undefined;
  const entry = Bun.file(resolve(webDirectory, "main.ts"));
  if (await entry.exists()) {
    const result = await Bun.build({entrypoints: [entry.name!], target: "browser", minify: true, define:{"process.env.NODE_ENV":'"production"'}});
    if (!result.success) throw new Error(`Browser build failed: ${result.logs.join("\n")}`);
    bundle = result.outputs.find(output => output.path.endsWith(".js"));
  }
  const service = new LivenessService(options.root, options.thresholds, options.namesFile);
  await service.start();
  const streams = new Set<() => void>();
  let server;
  try {
  server = Bun.serve({
    hostname: listen,
    port: options.port ?? 47881,
    maxRequestBodySize: 8192,
    async fetch(request, server) {
      const url = new URL(request.url);
      const origin = request.headers.get("origin");
      // Reject unexpected Host headers (DNS rebinding); never proxy the ?host input.
      const acceptableHost = !loopback.has(listen) || loopback.has(url.hostname);
      if (!acceptableHost) return new Response("Unrecognized Host", {status: 403});
      const originAllowed = !origin || origin === url.origin || allowedOrigins.has(origin);
      if (!originAllowed) return new Response("Origin not allowed; configure --allow-origin on the backend", {status: 403});
      const headers = new Headers({"Cache-Control":"no-store", "X-Content-Type-Options":"nosniff", "Referrer-Policy":"no-referrer"});
      if (origin) {
        headers.set("Access-Control-Allow-Origin", origin);
        headers.set("Vary", "Origin");
      }
      headers.set("Access-Control-Allow-Methods", "GET, PUT, OPTIONS");
      headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
      if (request.headers.get("access-control-request-private-network") === "true") headers.set("Access-Control-Allow-Private-Network", "true");
      const json = (value: unknown, status = 200) => Response.json(value, {status, headers});
      if (request.method === "OPTIONS") return new Response(null, {status: 204, headers});
      if (!url.pathname.startsWith("/api/")) {
        if (request.method !== "GET") return json({error:"Method not allowed"}, 405);
        headers.set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' http: https:; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
        if (url.pathname === "/" || url.pathname === "/index.html") {
          if (!bundle) return json({error:"Web bundle unavailable. Restart the server after building the frontend."}, 503);
          headers.set("Content-Type", "text/html; charset=utf-8");
          return new Response(Bun.file(resolve(webDirectory, "index.html")), {headers});
        }
        if (url.pathname === "/main.js" && bundle) {
          headers.set("Content-Type", "text/javascript; charset=utf-8");
          return new Response(bundle, {headers});
        }
        if (url.pathname === "/style.css") {
          headers.set("Content-Type", "text/css; charset=utf-8");
          return new Response(Bun.file(resolve(webDirectory, "style.css")), {headers});
        }
        return json({error:"Not found"}, 404);
      }
      if (!validToken(request.headers.get("authorization"), options.token)) return json({error:"A valid bearer token is required"}, 401);
      try {
        if (url.pathname === "/api/health" && request.method === "GET") {
          const snapshot = await service.snapshot();
          const ok = !service.error && snapshot.errors.length === 0;
          return json({ok, version:"jsonl-liveness/1", scannedAt:snapshot.scannedAt, files:snapshot.files.length, error:service.error ?? null, readErrors:snapshot.errors.length}, ok ? 200 : 503);
        }
        if (url.pathname === "/api/snapshot" && request.method === "GET") {
          if (service.error) return json({error:service.error, stale:true}, 503);
          return json(await service.snapshot());
        }
        if (url.pathname === "/api/timeline" && request.method === "GET") {
          if (service.error) return json({error:service.error, stale:true}, 503);
          const projects = url.searchParams.getAll("project");
          const project = projects.length ? projects : undefined;
          if (projects.length > 200 || projects.some(value=>value.length > 4096)) return json({error:"Project filter is too long"}, 400);
          const limit = Number(url.searchParams.get("limit") ?? 200);
          if (![20,50,100,200].includes(limit)) return json({error:"Expected limit=20, 50, 100 or 200"}, 400);
          return json(await service.timeline(project,limit));
        }
        if (["/api/session/detail","/api/session/preview","/api/session/fingerprint"].includes(url.pathname) && request.method === "GET") {
          const path = url.searchParams.get("path");
          const bytes = Number(url.searchParams.get("bytes") ?? DETAIL_BYTES);
          if (!path || ![DETAIL_BYTES, MAX_DETAIL_BYTES].includes(bytes)) return json({error:"Expected a session path and a 256 KiB or 1 MiB detail window"}, 400);
          try { return json(url.pathname.endsWith("/fingerprint") ? await service.fingerprint(path,url.searchParams.get("force")==="1") : url.pathname.endsWith("/preview") ? await service.preview(path) : await service.detail(path, bytes)); }
          catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            return json({error:String(error)}, /Unknown session|outside the configured root/.test(String(error)) ? 403 : code === "ENOENT" ? 404 : /File changed while hashing/.test(String(error)) ? 409 : 500);
          }
        }
        if (url.pathname === "/api/names" && request.method === "PUT") {
          if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return json({error:"Content-Type must be application/json"}, 415);
          let body: unknown;
          try { body = await request.json(); } catch { return json({error:"Invalid JSON"}, 400); }
          if (!body || typeof body !== "object" || typeof (body as any).path !== "string" || typeof (body as any).name !== "string") return json({error:"Expected {path, name} strings"}, 400);
          try { await service.rename((body as {path:string}).path, (body as {name:string}).name); }
          catch (error) {
            const message = String(error);
            return json({error:message}, /Unknown session|Names must/.test(message) ? 400 : 500);
          }
          return json({ok:true});
        }
        if (url.pathname === "/api/events" && request.method === "GET") {
          server.timeout(request, 0);
          headers.set("Content-Type", "text/event-stream");
          headers.set("X-Accel-Buffering", "no");
          const initial = await service.snapshot();
          let unsubscribe = () => {};
          let close = () => {};
          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              let closed = false;
              const encoder = new TextEncoder();
              close = () => {
                if (closed) return;
                closed = true;
                unsubscribe();
                streams.delete(close);
                try { controller.close(); } catch {}
              };
              const send = (snapshot: typeof initial) => {
                if (closed) return;
                if ((controller.desiredSize ?? 0) <= 0) { close(); return; }
                try { controller.enqueue(encoder.encode(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`)); }
                catch { close(); }
              };
              send(initial);
              unsubscribe = service.subscribe(send);
              streams.add(close);
            },
            cancel() { close(); },
          });
          return new Response(stream, {headers});
        }
        return json({error:"Unknown endpoint or unsupported method"}, 404);
      } catch (error) { return json({error:String(error)}, 500); }
    },
  });
  } catch (error) { service.stop(); throw error; }
  return {server, service, url: server.url.origin, stop() { for (const close of streams) close(); service.stop(); server.stop(true); }};
}
