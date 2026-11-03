/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Nunito', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'Consolas', 'monospace'],
      },
      colors: {
        // Marfil de la tienda y marron de la marca (el "Lucky Pet" del logotipo)
        crema: { DEFAULT: '#FFFBF5', honda: '#FFF3E3' },
        tinta: { DEFAULT: '#3A1F0F', suave: '#7C5F4C', tenue: '#A68B78' },
        borde: '#F6E4D0',
      },
      boxShadow: {
        suave: '0 1px 2px rgba(234, 88, 12, 0.05), 0 8px 24px -10px rgba(234, 88, 12, 0.16)',
        flota: '0 2px 4px rgba(120, 53, 15, 0.05), 0 24px 56px -16px rgba(194, 65, 12, 0.28)',
        boton: '0 6px 16px -6px rgba(234, 88, 12, 0.55)',
      },
    },
  },
  plugins: [],
}
