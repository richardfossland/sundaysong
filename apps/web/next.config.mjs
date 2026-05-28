import { join } from "node:path";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The public SDK is shipped as TypeScript source from the workspace.
  transpilePackages: ["@sunday/song-sdk", "@sundaysong/shared"],
  // Pin the file-tracing root to this repo (a stray lockfile in $HOME otherwise
  // confuses Next's monorepo-root inference).
  outputFileTracingRoot: join(import.meta.dirname, "..", ".."),
};

export default nextConfig;
