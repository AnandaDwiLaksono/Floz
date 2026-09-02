import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  distDir: process.env.FLOZ_NEXT_DIST_DIR || '.next',
};

export default nextConfig;
