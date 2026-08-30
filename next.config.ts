import type { NextConfig } from "next";

const config: NextConfig = {
  devIndicators: false,
  output: "standalone",
  outputFileTracingRoot: process.cwd(),
  experimental: { serverActions: { bodySizeLimit: "500mb" } },
};

export default config;
