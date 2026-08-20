import type { NextConfig } from "next";

/**
 * Uploads are stored by the API and served from its own `/media` mount, so their urls come back
 * root-relative (`/media/avatars/…`). They are proxied by the route handler at
 * `src/app/media/[...path]/route.ts` — not by a `rewrites()` entry here, because a rewrite
 * destination is resolved during `next build` and frozen into the standalone output, which pinned
 * every proxied upload to whatever origin the *build* happened to know.
 */
const nextConfig: NextConfig = {
  output: "standalone",
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "i.pravatar.cc" },
      // Gift model artwork comes from the same renderer the reference uses.
      { protocol: "https", hostname: "api.changes.tg" },
      { protocol: "http", hostname: "localhost", port: "8000" },
      { protocol: "http", hostname: "api", port: "8000" }
    ]
  }
};

export default nextConfig;
