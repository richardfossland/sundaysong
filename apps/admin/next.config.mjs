import { join } from "node:path";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  transpilePackages: ["@sunday/song-sdk", "@sundaysong/shared"],
  outputFileTracingRoot: join(import.meta.dirname, "..", ".."),
};

export default nextConfig;
