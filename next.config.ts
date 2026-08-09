import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Turbopack (dev) — boş config uyarıyı bastırır
  turbopack: {},
  // Webpack (production build) — onnxruntime-node tarayıcıya paketlenmesin
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      "sharp$": false,
      "onnxruntime-node$": false,
    };
    return config;
  },
};

export default nextConfig;
