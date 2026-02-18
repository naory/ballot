/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config) => {
    // snarkjs uses node built-ins — polyfill for client-side proof generation
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      readline: false,
    };
    return config;
  },
};

export default nextConfig;
