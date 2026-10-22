const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Docker image uses the self-contained server (see client/Dockerfile)
  output: process.env.NEXT_OUTPUT === 'standalone' ? 'standalone' : undefined,
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
    formats: ['image/avif', 'image/webp'],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
  },
  typescript: {
    // Type errors fail the build; run `npm run typecheck` locally.
    ignoreBuildErrors: false,
  },
  eslint: {
    // Lint runs during `next build` (only warnings remain; errors fail the build).
    ignoreDuringBuilds: false,
  },
  webpack: (config) => {
    config.resolve.alias['@'] = path.resolve(__dirname, 'src');
    return config;
  },
  async rewrites() {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || '/api';
    const destinationBase = apiUrl.endsWith('/api') ? apiUrl.slice(0, -4) : apiUrl;

    if (!apiUrl.startsWith('http')) {
      return [];
    }

    return [
      {
        source: '/api/:path*',
        destination: `${destinationBase}/api/:path*`,
      },
    ];
  },
  // Bundle optimization
  experimental: {
    optimizeCss: true,
    // npm workspaces hoist node_modules to the monorepo root
    outputFileTracingRoot: path.join(__dirname, '..'),
  },
  // Enable compression
  compress: true,
};

module.exports = nextConfig;
