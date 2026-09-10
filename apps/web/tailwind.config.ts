import type { Config } from "tailwindcss";

/**
 * Tailwind is kept for layout utilities; colour and type come from the Organic
 * tokens in globals.css. Mapping the palette onto CSS variables rather than
 * literals means the dark ground is a single `data-theme` swap — no `dark:`
 * variant on every element.
 */
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "var(--color-bg)",
        surface: "var(--color-surface)",
        ink: "var(--color-text)",
        divider: "var(--color-divider)",
        accent: {
          DEFAULT: "var(--color-accent)",
          100: "var(--color-accent-100)",
          200: "var(--color-accent-200)",
          300: "var(--color-accent-300)",
          400: "var(--color-accent-400)",
          500: "var(--color-accent-500)",
          600: "var(--color-accent-600)",
          700: "var(--color-accent-700)",
          800: "var(--color-accent-800)",
          900: "var(--color-accent-900)",
        },
        moss: {
          DEFAULT: "var(--color-accent-2)",
          100: "var(--color-accent-2-100)",
          300: "var(--color-accent-2-300)",
          600: "var(--color-accent-2-600)",
          800: "var(--color-accent-2-800)",
        },
      },
      fontFamily: {
        heading: ["var(--font-caprasimo)", "system-ui", "sans-serif"],
        body: ["var(--font-figtree)", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        card: "calc(var(--radius-lg) * 1.15)",
      },
      boxShadow: {
        sm: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
      },
      maxWidth: {
        shell: "1200px",
      },
    },
  },
  plugins: [],
};

export default config;
