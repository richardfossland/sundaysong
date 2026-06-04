import { join } from "node:path";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Self-contained server bundle for the Docker runtime image.
  output: "standalone",
  // The public SDK is shipped as TypeScript source from the workspace.
  transpilePackages: ["@sundaysong/sdk", "@sundaysong/shared"],
  // Pin the file-tracing root to this repo (a stray lockfile in $HOME otherwise
  // confuses Next's monorepo-root inference).
  outputFileTracingRoot: join(import.meta.dirname, "..", ".."),
};

export default nextConfig;
