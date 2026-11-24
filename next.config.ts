import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // GOS-IP uses request-time rendering for live intelligence data, so the
  // Cache Components model is intentionally left off.
  serverExternalPackages: ["sharp", "postgres"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
