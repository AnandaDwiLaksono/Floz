import type { NextConfig } from 'next';

const e2eDistDir = process.env.FLOZ_NEXT_DIST_DIR;

const nextConfig: NextConfig = {
  distDir: e2eDistDir || '.next',
  typescript: {
    tsconfigPath: e2eDistDir ? `${e2eDistDir}/tsconfig.json` : 'tsconfig.json',
  },
};

export default nextConfig;
