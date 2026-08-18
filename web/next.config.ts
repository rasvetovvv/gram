import type { NextConfig } from "next";

/**
 * Uploads are stored by the API and served from its own `/media` mount, so their urls come back
 * root-relative (`/media/avatars/…`). The browser would resolve those against this app's origin
 * and get a 404 — which is why an uploaded avatar or cover appeared blank while the seeded ones
 * (absolute urls) worked. Proxying the path keeps the url origin-relative and lets the two run
 * on different ports, in docker and locally alike.
 */
const apiOrigin =
  process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

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
  },
  async rewrites() {
    return [{ source: "/media/:path*", destination: `${apiOrigin}/media/:path*` }];
  }
};

export default nextConfig;
