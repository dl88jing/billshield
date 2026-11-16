"use client";
import { useEffect, useState } from "react";

/** Registers /sw.js (production builds only) and reports whether the app shell is cached. */
export function registerServiceWorker(): void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  if (process.env.NODE_ENV !== "production") return;
  navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
}

export interface OfflineState { online: boolean; offlineReady: boolean; }
export function useOfflineState(): OfflineState {
  const [s, setS] = useState<OfflineState>({ online: true, offlineReady: false });
  useEffect(() => {
    const update = () => setS({ online: navigator.onLine, offlineReady: Boolean(navigator.serviceWorker?.controller) });
    update();
    window.addEventListener("online", update); window.addEventListener("offline", update);
    navigator.serviceWorker?.addEventListener("controllerchange", update);
    navigator.serviceWorker?.ready.then(update).catch(() => undefined);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); navigator.serviceWorker?.removeEventListener("controllerchange", update); };
  }, []);
  return s;
}
