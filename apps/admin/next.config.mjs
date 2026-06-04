import { join } from "node:path";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  transpilePackages: ["@sundaysong/sdk", "@sundaysong/shared"],
  outputFileTracingRoot: join(import.meta.dirname, "..", ".."),
};

export default nextConfig;
