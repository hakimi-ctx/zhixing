import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Hide Next.js Dev Tools overlay (English-only UI) for end users.
  devIndicators: false,
  // Local Windows install: skip standalone tracing (hits EPERM on profile junctions under Cursor local-exec).
  compiler: {
    styledComponents: true,
  },
  transpilePackages: ['@primer/react', '@primer/octicons-react'],
  serverExternalPackages: ['cross-spawn', 'undici'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ]
  },
}

export default nextConfig

