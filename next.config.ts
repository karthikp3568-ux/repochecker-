import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Server-only packages that must not be bundled into route handlers.
  serverExternalPackages: [
    "bullmq",
    "ioredis",
    "pg",
    "@prisma/client",
    "@prisma/adapter-pg",
    "@vscode/ripgrep",
    "yauzl",
    "unpdf",
  ],
};

export default nextConfig;
