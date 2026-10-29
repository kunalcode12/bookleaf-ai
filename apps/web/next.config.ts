import type { NextConfig } from 'next';

const isProduction = process.env.NODE_ENV === 'production';

/**
 * The browser only ever talks to this origin: `/api/*` is forwarded to the API by `src/proxy.ts`,
 * so session cookies stay first-party and no API key or API host is exposed to the client.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  // Next.js inlines its bootstrap scripts; there is no third-party script on any page.
  `script-src 'self' 'unsafe-inline'${isProduction ? '' : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  // Attachments upload straight to Supabase Storage through short-lived signed URLs.
  "connect-src 'self' https://*.supabase.co",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    // Attachment uploads (up to 10 MB) pass through the proxy in local-storage mode.
    proxyClientMaxBodySize: '12mb',
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          ...(isProduction ? [{ key: 'Content-Security-Policy', value: contentSecurityPolicy }] : []),
        ],
      },
    ];
  },
};

export default nextConfig;
