/**
 * Uploads live on the API, under its own `/media` mount, and their urls come back root-relative
 * (`/media/avatars/…`). Proxying them here keeps those urls origin-relative, so the browser never
 * has to know where the API is.
 *
 * This used to be a `rewrites()` entry in `next.config.ts`, which was wrong in exactly the way
 * that mattered: with `output: "standalone"` a rewrite destination is resolved during `next build`
 * and frozen into `.next/required-server-files.json`. In the container the build only knows
 * `NEXT_PUBLIC_API_URL=http://localhost:8000`, so every proxied upload was fetched from the *web*
 * container itself — `ECONNREFUSED`, a 500, and a blank avatar. `API_INTERNAL_URL=http://api:8000`
 * was set, but only at runtime, far too late. A route handler reads the environment per request,
 * so the same image is correct in docker and on a laptop.
 */
/** Read per request, never at module load, so a build can never freeze the wrong origin in. */
const upstream = () =>
  process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

/** Headers worth carrying upstream: caching, and the range a video player seeks with. */
const FORWARDED_REQUEST_HEADERS = ["range", "if-none-match", "if-modified-since", "accept"];

/** Headers worth carrying back, so seeking and caching keep working through the proxy. */
const FORWARDED_RESPONSE_HEADERS = [
  "content-type",
  "content-length",
  "content-range",
  "accept-ranges",
  "etag",
  "last-modified",
  "cache-control"
];

const notFound = () => new Response("Not found", { status: 404 });

async function proxy(request: Request, segments: string[], method: "GET" | "HEAD") {
  // A segment can never be a traversal step or carry a separator of its own.
  if (
    !segments.length ||
    segments.some((part) => !part || part === "." || part === ".." || /[/\\]/.test(part))
  ) {
    return notFound();
  }

  const path = segments.map(encodeURIComponent).join("/");
  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  let response: Response;
  try {
    response = await fetch(`${upstream()}/media/${path}`, { method, headers, cache: "no-store" });
  } catch {
    return new Response("Media is unavailable", { status: 502 });
  }

  const out = new Headers();
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = response.headers.get(name);
    if (value) out.set(name, value);
  }
  // Uploads are somebody's bytes: never let a browser guess a type for them.
  out.set("X-Content-Type-Options", "nosniff");

  return new Response(method === "HEAD" ? null : response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: out
  });
}

export async function GET(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  return proxy(request, (await params).path ?? [], "GET");
}

export async function HEAD(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  return proxy(request, (await params).path ?? [], "HEAD");
}
