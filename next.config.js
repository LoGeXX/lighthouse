/** @type {import('next').NextConfig} */
const nextConfig = {
    reactStrictMode: true,
    swcMinify: true,
    // Ensure API routes are properly handled
    async rewrites() {
      return [
        {
          source: "/api/:path*",
          destination: "/api/:path*",
        },
      ]
    },
  }
  
  module.exports = nextConfig
  
  