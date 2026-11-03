import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pg", "sharp"],
};

export default nextConfig;
