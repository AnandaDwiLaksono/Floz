import type { NextConfig } from 'next';

const e2eDistDir = process.env.FLOZ_NEXT_DIST_DIR;

const nextConfig: NextConfig = {
  distDir: e2eDistDir || '.next',
  typescript: {
    tsconfigPath: e2eDistDir ? `${e2eDistDir}/tsconfig.json` : 'tsconfig.json',
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Strict-Transport-Security', value: 'max-age=15552000' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Content-Security-Policy', value: "base-uri 'self'; object-src 'none'; frame-ancestors 'none'" },
        ],
      },
    ];
  },
};

export default nextConfig;
