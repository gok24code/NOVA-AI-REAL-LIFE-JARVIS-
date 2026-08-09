/** @type {import('next').NextConfig} */
const nextConfig = {
  // Turbopack (next dev) — WASM and native modules handled automatically
  turbopack: {},

  // webpack (next build) — alias away onnxruntime-node on the client bundle
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.alias = {
        ...config.resolve.alias,
        "onnxruntime-node$": false,
        "sharp$": false,
      };
    }
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
    };
    return config;
  },
};

export default nextConfig;
