/** SOC-style palette: dark navy surfaces, electric-blue primary, cyan highlights; red/amber/green reserved for status. */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: { 950: '#070d19', 900: '#0b1220', 800: '#0f1a2e', 700: '#15233d', 600: '#1e3050', 500: '#2a4066' },
        edge: '#22324f', electric: { DEFAULT: '#2e8bff', 600: '#1f73e0' }, cyan: { soft: '#22d3ee' },
        crit: '#f43f5e', warn: '#f59e0b', ok: '#10b981',
      },
      fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'], mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'] },
    },
  },
  plugins: [],
};
