import type { NextConfig } from "next";
import { devOrigins } from "./lib/dev-origins";

/** Single-certification URLs from before multi-certification support; they now belong to PMLE. */
const LEGACY_SECTIONS = ["questions", "practice", "mock", "theory", "plan", "analytics", "blueprint", "common", "review", "flagged", "incorrect", "bookmarks", "data-quality"];

const nextConfig: NextConfig = {
  serverExternalPackages: ["@prisma/client", "playwright", "playwright-core"],
  devIndicators: false,
  allowedDevOrigins: devOrigins(),
  experimental: {
    // Uploads (PDF up to 25 MB) pass through proxy.ts, which would otherwise truncate bodies above 10 MB.
    proxyClientMaxBodySize: "26mb",
    serverActions: { bodySizeLimit: "2mb" },
  },
  async redirects() {
    return [
      ...LEGACY_SECTIONS.flatMap((s) => [
        { source: `/${s}`, destination: `/c/pmle/${s}`, permanent: false },
        { source: `/${s}/:path*`, destination: `/c/pmle/${s}/:path*`, permanent: false },
      ]),
      { source: "/pdf", destination: "/c/pmle/sources/pdf", permanent: false },
      { source: "/examprepper", destination: "/c/pmle/sources/examprepper", permanent: false },
    ];
  },
};

export default nextConfig;
