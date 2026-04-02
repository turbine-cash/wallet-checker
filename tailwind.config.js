/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        audit: {
          base: "#060915",
          panel: "#0A1020",
          cyan: "#82FFF4",
          amber: "#FFBF5F",
          violet: "#BA93FF",
          text: "#EEF4FF",
        },
      },
      fontFamily: {
        body: ['"IBM Plex Sans"', "sans-serif"],
        display: ['"Instrument Serif"', "serif"],
      },
    },
  },
  plugins: [],
};
