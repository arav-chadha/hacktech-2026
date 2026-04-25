import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          50: "#f8fafc",
          100: "#f1f5f9",
          200: "#e2e8f0",
          300: "#cbd5e1",
          400: "#94a3b8",
          500: "#64748b",
          600: "#475569",
          700: "#334155",
          800: "#1f2937",
          900: "#0f172a",
        },
        accent: {
          50: "#eef6ff",
          100: "#d9eafe",
          500: "#2563eb",
          600: "#1d4ed8",
          700: "#1e40af",
        },
        success: {
          50: "#effdf5",
          500: "#16a34a",
          700: "#15803d",
        },
        amber: {
          50: "#fffbeb",
          500: "#d97706",
          700: "#b45309",
        },
      },
      boxShadow: {
        panel: "0 10px 30px rgba(15, 23, 42, 0.06)",
      },
      borderRadius: {
        xl2: "1.25rem",
      },
      fontFamily: {
        sans: ['"Segoe UI Variable"', '"Aptos"', '"Helvetica Neue"', "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
