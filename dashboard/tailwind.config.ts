import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          50: "#fbf7f1",
          100: "#f4ede2",
          200: "#e4d8c6",
          300: "#cdbba6",
          400: "#a98d79",
          500: "#876b59",
          600: "#6d5447",
          700: "#533f36",
          800: "#3d2e28",
          900: "#261c18",
        },
        accent: {
          50: "#f6ebe5",
          100: "#ecd2c5",
          500: "#bd765e",
          600: "#a56550",
          700: "#814f3e",
        },
        success: {
          50: "#eef5ef",
          500: "#6f9075",
          700: "#4f6c55",
        },
        amber: {
          50: "#faf2e4",
          500: "#b99059",
          700: "#8e6e43",
        },
        blush: {
          50: "#fbf1ef",
          100: "#f4dfda",
          200: "#e8c2b9",
        },
        oat: {
          50: "#f8f3eb",
          100: "#efe4d4",
          200: "#e3d2b7",
        },
      },
      boxShadow: {
        panel: "0 18px 40px rgba(61, 46, 40, 0.08)",
        inset: "inset 0 1px 0 rgba(255, 255, 255, 0.75)",
      },
      borderRadius: {
        xl2: "1.25rem",
      },
      fontFamily: {
        sans: ['"Avenir Next"', '"Segoe UI Variable"', '"Helvetica Neue"', "sans-serif"],
        display: ['"Iowan Old Style"', '"Palatino Linotype"', "Georgia", "serif"],
      },
    },
  },
  plugins: [],
};

export default config;
