import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#7c8cf8',
          dark: '#6474f0',
          bg: 'rgba(124, 140, 248, 0.08)',
        },
      },
      boxShadow: {
        card: '0 8px 40px rgba(0, 0, 0, 0.45)',
        glow: '0 0 20px rgba(124, 140, 248, 0.2)',
      },
    },
  },
} satisfies Config;
