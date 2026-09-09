import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0d1117",
        panel: "#161b22",
        edge: "#30363d",
        muted: "#8b949e",
        accent: "#3fb950",
        warn: "#d29922",
        danger: "#f85149",
      },
    },
  },
  plugins: [],
};

export default config;
