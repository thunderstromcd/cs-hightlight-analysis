import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // Product UI should not show the bottom-left Next.js "N" badge.
  devIndicators: false,
  // Dev is opened as 127.0.0.1, not only as localhost.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  // The analyzer shells out to a binary that lives in its own package.
  serverExternalPackages: ["@akiver/cs-demo-analyzer"],
  experimental: {
    // GOTV demos are often tens or hundreds of megabytes.
    proxyClientMaxBodySize: "1gb",
    serverActions: {
      bodySizeLimit: "1gb",
    },
  },
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
