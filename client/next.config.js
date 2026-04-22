const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
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
  },
  // Enable compression
  compress: true,
};

module.exports = nextConfig;
