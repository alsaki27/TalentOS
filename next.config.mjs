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
  // server-side, so they stay excluded from the server bundle below.
  // jspdf, however, IS used server-side now: the AI pipeline renders resumes in
  // the Worker for page-fit measurement (hiringPanel.ts/finalPolish.ts) and for
  // the SharePoint auto-archive on finalization (finalizationService.ts). It
  // must NOT be excluded or aliased to false, or every server-side render
  // throws "jsPDF is not a constructor" and is silently swallowed - which left
  // page_fit_metrics null forever and meant no resume was ever auto-archived.
  experimental: {
    outputFileTracingExcludes: {
      "*": [
        "node_modules/@react-pdf/**",
        "node_modules/docx/**",
        "node_modules/fontkit/**",
        "node_modules/restructure/**",
        "node_modules/unicode-trie/**",
        "node_modules/unicode-properties/**",
        "node_modules/brotli/**",
      ],
    },
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.resolve.alias = {
        ...config.resolve.alias,
        'docx': false,
        '@react-pdf/renderer': false,
      };
    }
    return config;
  },
};

export default nextConfig;
