// Recreated from the exact shapes/colors in https://www.skarion.com/logo.svg
// (navy #122461 + coral #ff686b interlocking bars), simplified to a clean
// inline SVG instead of the original draw.io export markup.
export default function PortalLogo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 622 455" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <g fill="#122461">
        <rect x="32.19" y="31.27" width="134.09" height="105.86" transform="rotate(-45,99.24,84.2)" />
        <rect x="104.28" y="81.02" width="110" height="341.41" transform="rotate(-45,159.28,251.72)" />
        <rect x="261" y="281" width="134.09" height="105.86" transform="rotate(-45,328.05,333.93)" />
      </g>
      <g fill="#ff686b">
        <rect x="469" y="316.57" width="134.09" height="105.86" transform="rotate(-45,536.05,369.5)" />
        <rect x="406" y="25" width="110" height="341.41" transform="rotate(-45,461,195.71)" />
        <rect x="222.28" y="84.02" width="134.09" height="105.86" transform="rotate(-45,289.33,136.95)" />
      </g>
    </svg>
  );
}
