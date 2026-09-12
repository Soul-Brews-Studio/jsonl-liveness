/**
 * Static UI shell for Cloudflare Workers.
 *
 * The scanner and JSONL backend never run here. The browser connects directly to
 * the backend selected with ?host=, so session files and bearer tokens are not
 * proxied through Cloudflare.
 */
export interface Env {
  ASSETS: { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> };
}

function wantsHtml(request: Request): boolean {
  return (request.method === "GET" || request.method === "HEAD") &&
    (request.headers.get("accept") ?? "").includes("text/html");
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const asset = await env.ASSETS.fetch(request);
    if (asset.status !== 404 || !wantsHtml(request)) return asset;

    // Keep direct browser navigation inside the static SPA without treating API
    // paths as pages. Today UI state is query-based; this makes future routes safe.
    return env.ASSETS.fetch(new Request(new URL("/index.html", request.url), request));
  },
};
