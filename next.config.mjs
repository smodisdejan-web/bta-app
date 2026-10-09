// next.config.mjs
/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "placehold.co",
        port: "",
        pathname: "/**",
      }
    ],
    dangerouslyAllowSVG: true,
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
  },
  async rewrites() {
    return [];
  },
  // Competitor ad gallery is a static export in public/competitor-ads/ whose image paths are
  // relative (ads/<id>/...). Next strips trailing slashes (/competitor-ads/ -> /competitor-ads),
  // so a rewrite would serve the page at /competitor-ads and break those paths. Redirect to the
  // real file instead; the middleware still gates it behind the ai_unlock password.
  async redirects() {
    return [
    ];
  },
  outputFileTracingIncludes: {
    '/api/insights/**': ['./src/lib/knowledge/**/*.md'],
    '/api/cro-tower/**': ['./src/lib/knowledge/**/*.md'],
  },
};


export default nextConfig;
