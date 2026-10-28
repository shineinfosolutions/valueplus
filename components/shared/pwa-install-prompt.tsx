"use client";

import React, { useState, useEffect } from "react";
import { Download, Smartphone, CheckCircle2, X, Sparkles, Share, PlusSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

export function PWAInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isInstallable, setIsInstallable] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isBannerDismissed, setIsBannerDismissed] = useState(false);
  const [showIOSGuide, setShowIOSGuide] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    // Check if running in standalone mode (already installed as PWA)
    if (window.matchMedia("(display-mode: standalone)").matches || (window.navigator as any).standalone) {
      setIsInstalled(true);
      return;
    }

    // Detect iOS devices
    const userAgent = window.navigator.userAgent.toLowerCase();
    const isIosDevice = /iphone|ipad|ipod/.test(userAgent);
    setIsIOS(isIosDevice);

    if (isIosDevice) {
      setIsInstallable(true);
    }

    // Capture standard Chrome/Edge beforeinstallprompt event
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setIsInstallable(true);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstall);

    // Register service worker if available
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch((err) => {
        console.warn("ServiceWorker registration note:", err);
      });
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
    };
  }, []);

  const handleInstallClick = async () => {
    if (isIOS) {
      setShowIOSGuide(true);
      return;
    }

    if (!deferredPrompt) {
      // Fallback instruction
      alert("To install ValuePlus ERP: Open Chrome Menu (⋮) on top right and click 'Install App' or 'Add to Home screen'.");
      return;
    }

    deferredPrompt.prompt();
    const choiceResult = await deferredPrompt.userChoice;
    if (choiceResult.outcome === "accepted") {
      setIsInstalled(true);
      setIsInstallable(false);
    }
    setDeferredPrompt(null);
  };

  if (isInstalled || !isInstallable || isBannerDismissed) {
    return null;
  }

  return (
    <>
      {/* ─── FLOATING INSTALL BANNER (MOBILE & DESKTOP) ───────────────────── */}
      <div className="fixed top-20 right-4 left-4 sm:left-auto sm:w-96 z-40 animate-in fade-in slide-in-from-top-4 duration-300">
        <div className="bg-[#1B2537]/95 backdrop-blur-xl border border-emerald-500/40 rounded-2xl p-3.5 shadow-2xl text-white flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-[#76C043] to-emerald-400 text-slate-950 flex items-center justify-center font-black flex-shrink-0 shadow-md">
              <Smartphone className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-xs text-white">ValuePlus Mobile App</span>
                <span className="px-1.5 py-0.2 rounded-full bg-[#76C043]/20 text-[#76C043] text-[9px] font-black uppercase">
                  PWA
                </span>
              </div>
              <p className="text-[11px] text-slate-300 truncate">
                Install on phone for 1-tap billing & offline speed!
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <Button
              size="sm"
              onClick={handleInstallClick}
              className="h-8 px-3 rounded-xl bg-[#76C043] hover:bg-[#65a837] text-slate-950 font-black text-xs shadow-md gap-1"
            >
              <Download className="w-3.5 h-3.5" /> Install
            </Button>
            <button
              onClick={() => setIsBannerDismissed(true)}
              className="w-7 h-7 rounded-lg text-slate-400 hover:text-white flex items-center justify-center hover:bg-white/10"
              title="Dismiss"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* ─── IOS SAFARI ADD TO HOMESCREEN GUIDE ───────────────────────────── */}
      <Dialog open={showIOSGuide} onOpenChange={setShowIOSGuide}>
        <DialogContent className="max-w-md rounded-3xl bg-[#1B2537] text-white border-white/15 p-6">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-black">
              <Smartphone className="w-5 h-5 text-[#76C043]" /> Install on iPhone / iPad
            </DialogTitle>
            <DialogDescription className="text-slate-300 text-xs">
              Install ValuePlus ERP as a standalone app on your Apple home screen in 2 steps:
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3.5 my-2 text-xs">
            <div className="flex items-start gap-3 p-3 rounded-xl bg-white/5 border border-white/10">
              <div className="w-7 h-7 rounded-lg bg-blue-500/20 text-blue-400 flex items-center justify-center font-bold shrink-0">
                1
              </div>
              <div>
                <p className="font-bold text-white flex items-center gap-1.5">
                  Tap the <Share className="w-3.5 h-3.5 text-blue-400" /> Share Button
                </p>
                <p className="text-slate-400 text-[11px] mt-0.5">
                  In Safari browser bottom bar, tap the share icon.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-3 rounded-xl bg-white/5 border border-white/10">
              <div className="w-7 h-7 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold shrink-0">
                2
              </div>
              <div>
                <p className="font-bold text-white flex items-center gap-1.5">
                  Tap <PlusSquare className="w-3.5 h-3.5 text-emerald-400" /> Add to Home Screen
                </p>
                <p className="text-slate-400 text-[11px] mt-0.5">
                  Scroll down and tap &quot;Add to Home Screen&quot;, then tap &quot;Add&quot;.
                </p>
              </div>
            </div>
          </div>

          <Button
            onClick={() => setShowIOSGuide(false)}
            className="w-full bg-[#76C043] hover:bg-[#65a837] text-slate-950 font-black text-xs"
          >
            Got it, Let&apos;s Go!
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
