import type { NextConfig } from "next";
import { devOrigins } from "./lib/dev-origins";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@prisma/client"],
  devIndicators: false,
  allowedDevOrigins: devOrigins(),
};

export default nextConfig;
