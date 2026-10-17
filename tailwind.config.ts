import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        theme: {
          bg: "#FFFFFF",
          "bg-secondary": "#F7FAFC",
          "misty-bg": "#EEF6FB",
          "misty-light": "#E3F1F8",
          "primary-blue": "#6FA8C5",
          "strong-blue": "#4F8EAD",
          "dark-blue": "#24485A",
          "text-primary": "#1F2933",
          "text-secondary": "#667784",
          border: "#D9E8EF",
          hover: "#F0F7FA",
          success: "#5F9E7A",
          warning: "#C59A52",
          error: "#C96B6B",
        },
        background: "var(--background)",
        foreground: "var(--foreground)",
        card: "var(--card)",
        "card-foreground": "var(--card-foreground)",
        primary: {
          DEFAULT: "var(--primary)",
          foreground: "var(--primary-foreground)",
        },
        secondary: {
          DEFAULT: "var(--secondary)",
          foreground: "var(--secondary-foreground)",
        },
        muted: {
          DEFAULT: "var(--muted)",
          foreground: "var(--muted-foreground)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          foreground: "var(--accent-foreground)",
        },
        destructive: {
          DEFAULT: "var(--destructive)",
          foreground: "var(--destructive-foreground)",
        },
        border: "var(--border)",
        input: "var(--input)",
        ring: "var(--ring)",
      },
      fontFamily: {
        mono: ["var(--font-mono)", "JetBrains Mono", "SFMono-Regular", "Menlo", "Monaco", "Consolas", "monospace"],
        sans: ["var(--font-sans)", "Inter", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", "sans-serif"],
      },
      boxShadow: {
        subtle: "0 1px 3px 0 rgba(79, 142, 173, 0.08), 0 1px 2px 0 rgba(79, 142, 173, 0.04)",
        card: "0 2px 8px -2px rgba(36, 72, 90, 0.06), 0 1px 4px -1px rgba(36, 72, 90, 0.04)",
        dropdown: "0 8px 24px -4px rgba(36, 72, 90, 0.12), 0 4px 12px -2px rgba(36, 72, 90, 0.06)",
      },
      borderRadius: {
        theme: "8px",
        "theme-lg": "10px",
      },
    },
  },
  plugins: [],
};

export default config;
