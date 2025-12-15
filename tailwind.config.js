/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{vue,js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        safe: '#22c55e',
        warning: '#f59e0b',
        danger: '#ef4444',
      },
      spacing: {
        'chart-sm': '200px',
        'chart-lg': '300px',
      },
    },
  },
  plugins: [],
}


