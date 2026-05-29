/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./CleanUp.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        brand: {
          50: '#eef3fc', 100: '#d8e4f8', 200: '#b3c8f0', 300: '#84a4e6',
          400: '#5079d6', 500: '#2f5ac6', 600: '#1e50b8', 700: '#1a429a',
          800: '#18387d', 900: '#173265',
        },
        accent: {
          50:  'rgb(var(--a50) / <alpha-value>)',
          100: 'rgb(var(--a100) / <alpha-value>)',
          500: 'rgb(var(--a500) / <alpha-value>)',
          600: 'rgb(var(--a600) / <alpha-value>)',
          700: 'rgb(var(--a700) / <alpha-value>)',
        },
      },
    },
  },
  // Färgvarianter som byggs i objekt-/uppslagstabeller (notiser, badges, toner).
  // De finns som literala strängar i koden, men safelistas som försäkring.
  safelist: [
    {
      pattern:
        /^(bg|text|border|ring)-(brand|accent|emerald|rose|amber|sky|slate)-(50|100|200|300|400|500|600|700|800|900)$/,
    },
  ],
  plugins: [],
};
