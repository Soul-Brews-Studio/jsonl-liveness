# Deploy the frontend to Cloudflare Workers

JSONL Liveness has a **frontend-only** Cloudflare Worker. It serves the compiled
React/Tailwind UI as static assets. It does not scan JSONL files, store sessions,
proxy requests, receive bearer tokens, or run the Bun backend.

The browser continues to connect directly to the backend selected by the existing
`?host=` pattern. For example:

```text
https://jsonl-liveness.<your-subdomain>.workers.dev/?host=https%3A%2F%2Fjsonl-api.example
```

## One-click deploy

Use the public-repository button in the [README](../README.md). Cloudflare will
ask you to sign in, clone the repository to your account, configure a Worker,
and deploy it. This is Cloudflare's standard **Deploy to Cloudflare** flow.

At the import screen, use these build settings if they are not pre-filled:

| Setting | Value |
| --- | --- |
| Root directory | `/` |
| Build command | `bun run build` |
| Deploy command | `npx wrangler deploy` |
| Package manager | Bun (or use the existing `package-lock.json` and keep the build command above) |

Workers Builds supports Bun; its build image currently provides Bun. Pin a
`BUN_VERSION` build variable in Cloudflare if your account requires a specific
Bun release.

## CLI deploy for repository owners

```sh
npm ci
bun run deploy:cloudflare
```

The first `wrangler deploy` authenticates with Cloudflare and creates/updates the
Worker named `jsonl-liveness`. To avoid changing a shared Worker, use Wrangler's
`--name your-jsonl-liveness` option.

For a local Workers-runtime preview:

```sh
npm ci
bun run dev:cloudflare
```

`dist/` is generated and ignored. `bun run build:cloudflare` builds the Tailwind
CSS and browser bundle, then copies only `index.html`, `style.css`, and `main.js`
to that directory. The Worker can therefore publish no repository source files
or transcripts as static assets.

## Connect a backend safely

The deployed UI needs a separately reachable HTTPS JSONL backend. It cannot make
a loopback-only scanner public, and it cannot bypass browser mixed-content or
private-network restrictions.

On the backend host, set a random token outside the repository and allow only the
exact deployed Worker origin:

```sh
export JSONL_TOKEN='replace-with-a-long-random-secret'
bun run . --serve --listen 0.0.0.0 --root /path/to/projects \
  --allow-origin https://jsonl-liveness.<your-subdomain>.workers.dev
```

Terminate the Bun HTTP server behind your own HTTPS endpoint or VPN, then open
that endpoint through the frontend's **Backend host** field or `?host=`. Paste
the token into the browser only when connecting; the UI keeps it in memory and
does not put it in a URL.

The Worker is deliberately not an API proxy: a proxy would turn the public
frontend deployment into a path to private transcript data and would weaken the
backend's exact-origin policy.
