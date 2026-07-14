import type { NextConfig } from "next";
import { securityHeadersConfig } from "@/src/lib/security-headers";

const nextConfig: NextConfig = {
  // Defence-in-depth response headers on every route (COV-13). Policy + tests live in
  // src/lib/security-headers.ts.
  async headers() {
    return securityHeadersConfig();
  },
};

export default nextConfig;
