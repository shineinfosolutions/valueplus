"use client";

import { useEffect } from "react";

/**
 * The "Install ValuePlus Mobile App" banner was removed. This only keeps the service worker registered
 * (offline pages and push notifications need it) and shows nothing.
 */
export function PWAInstallPrompt() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.warn("ServiceWorker registration note:", err);
    });
  }, []);
  return null;
}
