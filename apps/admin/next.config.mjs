import { join } from "node:path";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Lastbærende: `typescript` peker på TS 6-API-et (@typescript/typescript6),
  // som ikke har bin.tsc. Uten denne feiler `next build`. Se docs/DECISIONS.md ADR-001.
  experimental: { useTypeScriptCli: false },
  reactStrictMode: true,
  output: "standalone",
  transpilePackages: ["@sundaysong/sdk", "@sundaysong/shared"],
  outputFileTracingRoot: join(import.meta.dirname, "..", ".."),
};

export default nextConfig;
