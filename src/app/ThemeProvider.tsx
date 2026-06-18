// src/app/ThemeProvider.tsx
"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";

type Theme = "light" | "dark" | "system";

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  resolved: "light" | "dark";
}

const ThemeContext = createContext<ThemeContextType>({
  theme: "system",
  setTheme: () => {},
  resolved: "light",
});

export function useTheme() {
  return useContext(ThemeContext);
}

export default function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("system");
  const [resolved, setResolved] = useState<"light" | "dark">("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const stored = localStorage.getItem("talentos-theme") as Theme | null;
    if (stored && ["light", "dark", "system"].includes(stored)) {
      setThemeState(stored);
    }
  }, []);

  useEffect(() => {
    if (!mounted) return;
    localStorage.setItem("talentos-theme", theme);

    const root = document.documentElement;
    const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const isDark = theme === "dark" || (theme === "system" && systemDark);

    setResolved(isDark ? "dark" : "light");
    if (isDark) {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
  }, [theme, mounted]);

  useEffect(() => {
    if (!mounted) return;
    const listener = (e: MediaQueryListEvent) => {
      if (theme === "system") {
        const isDark = e.matches;
        setResolved(isDark ? "dark" : "light");
        const root = document.documentElement;
        if (isDark) root.classList.add("dark");
        else root.classList.remove("dark");
      }
    };
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", listener);
    return () => mq.removeEventListener("change", listener);
  }, [theme, mounted]);

  function setTheme(t: Theme) {
    setThemeState(t);
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme, resolved }}>
      {children}
    </ThemeContext.Provider>
  );
}
