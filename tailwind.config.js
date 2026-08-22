/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{vue,js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Warm-shifted dark ground. The app is about heat, so a cool neutral
        // fights every accent.
        ground: '#14110F',
        raised: '#1E1A17',
        rule: '#2C2621',
        ink: '#F5F0EA',
        'ink-dim': '#A79C91',
        'ink-mute': '#776C62',

        // Saturated: live measurement only — the temperature line, the heat
        // rail and the oven track.
        'heat-cold': '#4E7FA8',
        'heat-warm': '#D98324',
        'heat-hot': '#E0452A',

        // Muted: interpretation — verdicts, chips, status. Never placed
        // adjacent to the heat ramp.
        ontrack: '#4E9E68',
        late: '#C9922F',
        early: '#5B87A8',

        danger: '#D9432F',
      },
      fontFamily: {
        display: ['"Barlow Semi Condensed"', 'system-ui', 'sans-serif'],
        sans: ['"Instrument Sans"', '-apple-system', 'BlinkMacSystemFont', 'system-ui', 'sans-serif'],
      },
      spacing: {
        gutter: '16px',
      },
    },
  },
  plugins: [],
}
