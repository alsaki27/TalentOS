/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**" },
    ],
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  // @react-pdf/renderer and docx are only ever imported via dynamic import()
  // inside client components (see src/lib/falood/clientExport.tsx) - never used
  // server-side. Despite that, Next's "standalone" output file tracing still
  // copies their node_modules into the deploy bundle (it traces all reachable
  // files, client chunks included, not just server imports), and wrangler's own
  // bundler picks them up from there. Confirmed via a real deploy attempt:
  // node_modules/@react-pdf/pdfkit/lib/pdfkit.browser.js (900 KiB) was flagged as
  // one of the largest dependencies "included in your script", pushing the
  // Worker over Cloudflare's 3 MiB free-plan size limit. Excluding them from
  // file tracing is the documented fix for exactly this situation.
  experimental: {
    outputFileTracingExcludes: {
      "*": [
        "node_modules/@react-pdf/**",
        "node_modules/docx/**",
        "node_modules/jspdf/**",
        "node_modules/fontkit/**",
        "node_modules/restructure/**",
        "node_modules/unicode-trie/**",
        "node_modules/unicode-properties/**",
        "node_modules/brotli/**",
      ],
    },
  },
};

export default nextConfig;
