/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eff6ff",
          500: "#3b82f6",
          700: "#1d4ed8",
          900: "#1e3a8a"
        },
        sales: "#16a34a",      // green
        purchase: "#ea580c",   // orange
        profit: "#7c3aed",     // purple
        rx: "#2563eb",         // blue (receivable)
        payable: "#dc2626",    // red
        warning: "#d97706",    // amber
      },
      fontFamily: {
        sans: ["Inter", "sans-serif"]
      },
      keyframes: {
        slideUp: {
          "0%": { transform: "translateY(100%)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
      },
      animation: {
        "slide-up": "slideUp 0.3s ease-out",
      },
    },
  },
  plugins: [],
};
