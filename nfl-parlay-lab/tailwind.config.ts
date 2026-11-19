import type { Config } from 'tailwindcss';
export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: { extend: { colors: { bg: '#0a0e17', card: '#121a2b', line: '#22304d', blue: '#2d8cff', neon: '#39ff88' } } },
  plugins: [],
} satisfies Config;
