"use client";

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { useSession } from "next-auth/react";
import {
  getOfflineInvoices,
  syncOfflineInvoices,
  cacheCatalogItems,
  cacheCustomers,
  getOfflineCatalogFetchedAt,
  markOfflineCatalogFetched,
  shouldPreloadOfflineCatalog,
} from "@/lib/offline-storage";
import { toast } from "sonner";
import { Wifi, WifiOff, RefreshCw, CheckCircle2, CloudUpload, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";

interface OfflineSyncContextType {
  isOnline: boolean;
  pendingCount: number;
  isSyncing: boolean;
  syncNow: () => Promise<void>;
}

const OfflineSyncContext = createContext<OfflineSyncContextType>({
  isOnline: true,
  pendingCount: 0,
  isSyncing: false,
  syncNow: async () => {},
});

export const useOfflineSync = () => useContext(OfflineSyncContext);

export function OfflineSyncProvider({ children }: { children: React.ReactNode }) {
  const [isOnline, setIsOnline] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);

  // Update pending offline invoices count
  const refreshPendingCount = useCallback(() => {
    const invoices = getOfflineInvoices();
    setPendingCount(invoices.length);
  }, []);

  // Read through a ref, so syncNow keeps one identity: the listeners below are set up once
  // and are not torn down and re-added (with another catalog download) each time a sync starts or ends.
  const syncingRef = useRef(false);

  // Sync execution
  const syncNow = useCallback(async () => {
    if (!navigator.onLine || syncingRef.current) return;
    const currentQueue = getOfflineInvoices();
    if (currentQueue.length === 0) return;

    syncingRef.current = true;
    setIsSyncing(true);
    toast.loading(`Syncing ${currentQueue.length} offline invoice(s) with cloud database...`, { id: "offline-sync" });

    try {
      const result = await syncOfflineInvoices();
      if (result.synced > 0) {
        toast.success(`✓ Successfully synced ${result.synced} offline invoice(s) with database!`, { id: "offline-sync" });
      } else if (result.failed > 0) {
        toast.error(`Failed to sync ${result.failed} invoice(s). Will retry automatically.`, { id: "offline-sync" });
      } else {
        toast.dismiss("offline-sync");
      }
    } catch (err) {
      console.error("Auto sync error:", err);
      toast.error("Auto-sync error. Please check your internet connection.", { id: "offline-sync" });
    } finally {
      syncingRef.current = false;
      setIsSyncing(false);
      refreshPendingCount();
    }
  }, [refreshPendingCount]);
  const syncNowRef = useRef(syncNow);
  syncNowRef.current = syncNow;

  // Initial load and network listeners
  useEffect(() => {
    setIsOnline(navigator.onLine);
    refreshPendingCount();

    const handleOnline = () => {
      setIsOnline(true);
      toast.success("🌐 Internet connection restored! Auto-syncing pending offline records...", { duration: 4000 });
      // Trigger automatic sync after 1s debounce
      setTimeout(() => {
        syncNowRef.current();
      }, 1000);
    };

    const handleOffline = () => {
      setIsOnline(false);
      toast.warning("⚠️ Internet disconnected. Switched to Offline Mode. You can continue creating & printing invoices locally.", { duration: 5000 });
    };

    const handleQueueChange = (e: any) => {
      if (e?.detail?.count !== undefined) {
        setPendingCount(e.detail.count);
      } else {
        refreshPendingCount();
      }
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("valueplus-offline-queue-changed", handleQueueChange);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("valueplus-offline-queue-changed", handleQueueChange);
    };
  }, [refreshPendingCount]);

  // Offline copy of the product and customer lists, for bills made while the internet is down.
  // Only for the roles that bill, never before sign-in, and at most once every 12 hours on this
  // device (see shouldPreloadOfflineCatalog). A bill saved online does not refresh it: the next
  // download within 12 hours is soon enough for an offline fallback.
  const { status: sessionStatus, data: session } = useSession();
  const role = String((session?.user as any)?.role || "").toLowerCase();
  const signedIn = sessionStatus === "authenticated";
  useEffect(() => {
    if (
      !shouldPreloadOfflineCatalog({
        signedIn,
        role,
        online: typeof navigator === "undefined" ? false : navigator.onLine,
        lastFetchedAt: getOfflineCatalogFetchedAt(),
        now: Date.now(),
      })
    ) {
      return;
    }
    let cancelled = false;
    const load = async (url: string) => {
      const res = await fetch(url);
      const json = await res.json();
      return json?.success && Array.isArray(json.data) ? (json.data as any[]) : null;
    };
    Promise.all([load("/api/items"), load("/api/customers")])
      .then(([items, customers]) => {
        if (items) cacheCatalogItems(items);
        if (customers) cacheCustomers(customers);
        // Counted as done only when both lists came back, so a failed download is tried again next open.
        if (items && customers && !cancelled) markOfflineCatalogFetched();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [signedIn, role]);

  return (
    <OfflineSyncContext.Provider value={{ isOnline, pendingCount, isSyncing, syncNow }}>
      {children}

      {/* Floating Offline / Sync Banner when Offline or Pending Invoices */}
      {(!isOnline || pendingCount > 0) && (
        <div className="fixed bottom-4 right-4 z-50 animate-in fade-in slide-in-from-bottom-3 duration-300">
          <div className={`p-3.5 rounded-2xl shadow-2xl border flex items-center gap-3.5 backdrop-blur-md ${
            !isOnline 
              ? "bg-amber-950/90 border-amber-500/30 text-white shadow-amber-900/30" 
              : "bg-slate-900/90 border-slate-700 text-white shadow-slate-950/40"
          }`}>
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
              !isOnline ? "bg-amber-500/20 text-amber-400" : "bg-blue-500/20 text-blue-400"
            }`}>
              {!isOnline ? <WifiOff className="w-4 h-4" /> : <CloudUpload className="w-4 h-4" />}
            </div>

            <div className="text-left pr-2">
              <div className="flex items-center gap-2">
                <p className="text-xs font-black tracking-tight">
                  {!isOnline ? "Offline Mode Active" : "Offline Records Pending"}
                </p>
                <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-bold bg-white/20 text-white">
                  {pendingCount} Queued
                </span>
              </div>
              <p className="text-[11px] text-slate-300 mt-0.5">
                {!isOnline 
                  ? "Invoices will be saved locally and printed on spot." 
                  : "Ready to sync with cloud database."}
              </p>
            </div>

            {isOnline && pendingCount > 0 && (
              <Button
                size="sm"
                onClick={syncNow}
                disabled={isSyncing}
                className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs h-8 font-bold rounded-xl shadow-sm ml-1"
              >
                <RefreshCw className={`w-3 h-3 mr-1.5 ${isSyncing ? "animate-spin" : ""}`} />
                {isSyncing ? "Syncing..." : "Sync Now"}
              </Button>
            )}
          </div>
        </div>
      )}
    </OfflineSyncContext.Provider>
  );
}
