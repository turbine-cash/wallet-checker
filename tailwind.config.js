/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        turbine: {
          black: "#000000",
          charcoal: "#1F1F1F",
          gray: "#2A2A2A",
          orange: "#F97315",
          green: "#4ADE80",
          silver: "#ECEEF1",
          slate: "#88898B",
          "light-gray": "#FFFFFF",
        },
        "turbine-cash": {
          silver: "#ECEEF1",
          white: "#FFFFFF",
          orange: "#F97315",
        },
      },
      fontFamily: {
        "turbine-cash": ["Outfit", "sans-serif"],
      },
    },
  },
  plugins: [],
};
