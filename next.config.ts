import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/*": ["./vendor/**"],
  },
  serverExternalPackages: ["@vercel/sandbox"],
};

export default nextConfig;
