import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Static HTML export for Cloudflare Workers Static Assets.
  // The mailto contact form is client-side only, so no server is required.
  output: "export",
  // next/image optimization is not used today; this keeps a future
  // <Image> from breaking the static export.
  images: { unoptimized: true },
};

export default nextConfig;
