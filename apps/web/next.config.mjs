import { join } from "node:path";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Lastbærende: `typescript` peker på TS 6-API-et (@typescript/typescript6),
  // som ikke har bin.tsc. Uten denne feiler `next build`. Se docs/DECISIONS.md ADR-001.
  experimental: { useTypeScriptCli: false },
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
