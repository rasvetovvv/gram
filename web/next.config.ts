import type { NextConfig } from "next";

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
