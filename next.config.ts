import type { NextConfig } from 'next';

// The game is fully client-side, so static export keeps deployments portable.
const nextConfig: NextConfig = {
  output: 'export',
};

export default nextConfig;
