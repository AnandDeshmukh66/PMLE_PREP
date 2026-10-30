import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      "server-only": path.resolve(__dirname, "tests/stubs/empty.ts"),
      "next/cache": path.resolve(__dirname, "tests/stubs/next-cache.ts"),
      "next/headers": path.resolve(__dirname, "tests/stubs/next-headers.ts"),
      "next/navigation": path.resolve(__dirname, "tests/stubs/next-navigation.ts"),
    },
  },
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    environment: "node",
    testTimeout: 120000,
    hookTimeout: 300000,
    fileParallelism: false,
  },
});
