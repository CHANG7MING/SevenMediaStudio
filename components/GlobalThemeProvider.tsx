"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useState } from "react";

type RouteTransition = { path: string; label: string; opening: boolean };
type ThemeContextValue = { dark: boolean; toggleTheme: () => void; startRouteTransition: (path: string, label: string) => void };
const ThemeContext = createContext<ThemeContextValue | null>(null);

export function GlobalThemeProvider({ children }: { children: React.ReactNode }) {
  const [dark, setDark] = useState(false);
  const [routeTransition, setRouteTransition] = useState<RouteTransition | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    const saved = localStorage.getItem("sevenmedia-theme") ?? localStorage.getItem("sevencompress-theme");
    setDark(saved ? saved === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches);
  }, []);
  useEffect(() => { document.documentElement.dataset.theme = dark ? "dark" : "light"; }, [dark]);
  useEffect(() => {
    if (!routeTransition || routeTransition.opening || pathname !== routeTransition.path) return;
    const openTimer = window.setTimeout(() => setRouteTransition((current) => current ? { ...current, opening: true } : null), 80);
    return () => window.clearTimeout(openTimer);
  }, [pathname, routeTransition]);
  useEffect(() => {
    if (!routeTransition?.opening) return;
    const removeTimer = window.setTimeout(() => setRouteTransition(null), 900);
    return () => window.clearTimeout(removeTimer);
  }, [routeTransition?.opening]);
  const value = useMemo(() => ({
    dark,
    toggleTheme: () => setDark((current) => { const next = !current; localStorage.setItem("sevenmedia-theme", next ? "dark" : "light"); return next; }),
    startRouteTransition: (path: string, label: string) => {
      if (routeTransition) return;
      setRouteTransition({ path, label, opening: false });
      window.setTimeout(() => router.push(path), 1500);
    },
  }), [dark, routeTransition, router]);
  return <ThemeContext.Provider value={value}>{children}{routeTransition && <div className={`route-loading-screen ${dark ? "is-dark" : ""} ${routeTransition.opening ? "is-opening" : ""}`} role="status" aria-label={`正在进入${routeTransition.label}`}>
    <div className="route-loading-panel route-loading-panel-top" />
    <div className="route-loading-panel route-loading-panel-bottom" />
    <div className="route-loading-orbit" aria-hidden="true">
      {["outer", "middle", "inner"].map((ring) => <span className={`route-loading-ring route-loading-ring-${ring}`} key={ring}>{Array.from({ length: 8 }, (_, index) => <i key={index} style={{ "--dot-index": index } as React.CSSProperties} />)}</span>)}
      <span className="route-loading-avatar-wrap"><img src="/character-head-transparent.png" alt="" className="route-loading-avatar" /></span>
    </div>
  </div>}</ThemeContext.Provider>;
}

export function useGlobalTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useGlobalTheme must be used inside GlobalThemeProvider");
  return value;
}
