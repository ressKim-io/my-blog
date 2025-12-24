import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === 'production';

const nextConfig: NextConfig = {
  output: 'export',
  basePath: isProd ? '/my-blog' : '',
  assetPrefix: isProd ? '/my-blog/' : '',
  images: {
    unoptimized: true,
  },
  trailingSlash: true,
};

export default nextConfig;
