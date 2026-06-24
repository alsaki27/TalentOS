module.exports = {
  content: [
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        ink: '#1a1d23',
        'ink-soft': '#5a5f6b',
        bg: '#f7f7f8',
        surface: '#ffffff',
        border: '#e2e4e8',
        accent: '#2a6f4f',
        'accent-soft': '#e7f2ec',
        warn: '#b3541e',
        danger: '#b3261e',
      },
      borderRadius: {
        DEFAULT: '8px',
      },
    },
  },
  plugins: [],
};
