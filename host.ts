/** Studio-style host selection: bare host:port means HTTP; no implicit proxy. */
export function normalizeHost(value: string): string {
  const input = value.trim();
  if (!input) throw new Error("Enter a backend host, for example localhost:47881");
  const url = new URL(input.includes("://") ? input : `http://${input}`);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
      (url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) {
    throw new Error("Host must be an HTTP(S) origin without credentials, path, query, or fragment");
  }
  return url.origin;
}
