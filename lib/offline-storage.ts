/**
 * ValuePlus ERP - Offline Storage & Local Sync Engine
 * Handles persistent offline queue in IndexedDB/localStorage for offline invoicing,
 * offline PDF/print generation, and background cloud sync upon network reconnect.
 */

export interface OfflineInvoice {
  offlineId: string;
  invoiceNumber: string;
  type: string;
  customerId: string;
  customerName: string;
  customerPhone?: string;
  billingAddress?: any;
  shippingAddress?: any;
  date: string;
  dueDate: string;
  status: "paid" | "partial" | "pending";
  items: Array<{
    itemId: string;
    itemName: string;
    quantity: number;
    rate: number;
    gstRate: number;
    amount: number;
    serialNumbers?: string[];
  }>;
  subtotal: number;
  discount: number;
  taxableAmount: number;
  cgst: number;
  sgst: number;
  igst: number;
  totalGST: number;
  roundOff: number;
  total: number;
  paidAmount: number;
  balanceAmount: number;
  paymentMode: string;
  paymentTerms: string;
  createdAt: string;
  isOffline: true;
}

const STORAGE_KEYS = {
  OFFLINE_INVOICES: "valueplus_offline_invoices_v1",
  CACHED_ITEMS: "valueplus_cached_items_v1",
  CACHED_CUSTOMERS: "valueplus_cached_customers_v1",
  CATALOG_FETCHED_AT: "valueplus_cached_catalog_fetched_at_v1",
  DASHBOARD_STATS_PREFIX: "valueplus_dashboard_stats_",
  DASHBOARD_EXTENDED: "valueplus_dashboard_extended_v1",
};

/**
 * Cache Dashboard Stats & Widgets for offline instant render
 */
export function cacheDashboardStats(key: string, data: any): void {
  if (typeof window === "undefined" || !data) return;
  try {
    localStorage.setItem(`${STORAGE_KEYS.DASHBOARD_STATS_PREFIX}${key}`, JSON.stringify({
      data,
      cachedAt: new Date().toISOString(),
    }));
  } catch (err) {
    console.warn("Dashboard stats cache save error:", err);
  }
}

// This cache exists purely to paint the dashboard instantly on load, before the
// network request finishes — it was never meant to be a source of truth. It had
// no expiry at all, so a browser could go on showing a number from hours (or
// days) earlier if a later fetch silently failed, and even on the happy path it
// visibly flashed a stale figure for a moment on every load. A cancelled or
// deleted invoice changes what today's numbers should be immediately, so a
// cache this old is no longer "a little behind" — it's simply wrong.
const DASHBOARD_STATS_CACHE_TTL_MS = 2 * 60 * 1000;

export function getCachedDashboardStats(key: string): any | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(`${STORAGE_KEYS.DASHBOARD_STATS_PREFIX}${key}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const cachedAt = parsed?.cachedAt ? new Date(parsed.cachedAt).getTime() : 0;
    if (!cachedAt || Date.now() - cachedAt > DASHBOARD_STATS_CACHE_TTL_MS) {
      return null;
    }
    return parsed?.data || null;
  } catch (err) {
    return null;
  }
}

/**
 * Cache Dashboard Extended Data (Stock breakdown, Warranty, Audit, Staff)
 */
export function cacheDashboardExtended(data: any): void {
  if (typeof window === "undefined" || !data) return;
  try {
    const existing = getCachedDashboardExtended() || {};
    localStorage.setItem(STORAGE_KEYS.DASHBOARD_EXTENDED, JSON.stringify({
      data: { ...existing, ...data },
      cachedAt: new Date().toISOString(),
    }));
  } catch (err) {
    console.warn("Dashboard extended cache save error:", err);
  }
}

export function getCachedDashboardExtended(): any | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.DASHBOARD_EXTENDED);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.data || null;
  } catch (err) {
    return null;
  }
}

/**
 * Get all queued offline invoices from local storage
 */
export function getOfflineInvoices(): OfflineInvoice[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.OFFLINE_INVOICES);
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    console.error("Failed to read offline invoices:", err);
    return [];
  }
}

/**
 * Save a new invoice into the offline queue
 */
export function saveOfflineInvoice(invoice: Omit<OfflineInvoice, "offlineId" | "isOffline"> & { offlineId?: string }): OfflineInvoice {
  if (typeof window === "undefined") throw new Error("Window is not available");

  const existing = getOfflineInvoices();
  const offlineId = invoice.offlineId || `off_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  
  const record: OfflineInvoice = {
    ...invoice,
    offlineId,
    isOffline: true,
    createdAt: invoice.createdAt || new Date().toISOString(),
  };

  const updated = [record, ...existing.filter(item => item.offlineId !== offlineId)];
  localStorage.setItem(STORAGE_KEYS.OFFLINE_INVOICES, JSON.stringify(updated));

  // Dispatch custom event for real-time UI updates
  window.dispatchEvent(new CustomEvent("valueplus-offline-queue-changed", { detail: { count: updated.length } }));

  return record;
}

/**
 * Remove a synced invoice from the offline queue
 */
export function removeOfflineInvoice(offlineId: string): void {
  if (typeof window === "undefined") return;
  const existing = getOfflineInvoices();
  const updated = existing.filter(item => item.offlineId !== offlineId);
  localStorage.setItem(STORAGE_KEYS.OFFLINE_INVOICES, JSON.stringify(updated));

  window.dispatchEvent(new CustomEvent("valueplus-offline-queue-changed", { detail: { count: updated.length } }));
}

/**
 * When to download the full product and customer lists for offline billing.
 *
 * They used to be downloaded on every app open, on every phone, for every role — even
 * on the login screen — which made them two of the heaviest calls the app makes. Only
 * the roles that make bills need them offline, and the lists change slowly enough that
 * a copy up to 12 hours old is fine for a bill made while the internet is down (the
 * billing form itself always loads the live lists while online).
 */
export const OFFLINE_CATALOG_ROLES = ["admin", "superadmin", "manager", "cashier"];
export const OFFLINE_CATALOG_MAX_AGE_MS = 12 * 60 * 60 * 1000;

export function shouldPreloadOfflineCatalog(opts: {
  signedIn: boolean;
  role: string;
  online: boolean;
  lastFetchedAt: number | null;
  now: number;
}): boolean {
  if (!opts.signedIn || !opts.online) return false;
  if (!OFFLINE_CATALOG_ROLES.includes(String(opts.role || "").toLowerCase())) return false;
  const last = opts.lastFetchedAt;
  if (last === null || !Number.isFinite(last)) return true;
  // A time in the future means the phone's clock was changed: do not trust it.
  if (last > opts.now) return true;
  return opts.now - last >= OFFLINE_CATALOG_MAX_AGE_MS;
}

/** When this device last downloaded the offline product/customer lists (ms), or null. */
export function getOfflineCatalogFetchedAt(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.CATALOG_FETCHED_AT);
    const n = raw === null ? NaN : Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export function markOfflineCatalogFetched(at: number = Date.now()): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEYS.CATALOG_FETCHED_AT, String(at));
  } catch {
    // Storage full or blocked: the lists are simply downloaded again next time.
  }
}

/**
 * Cache Catalog Items for offline autocomplete
 */
export function cacheCatalogItems(items: any[]): void {
  if (typeof window === "undefined" || !Array.isArray(items)) return;
  try {
    localStorage.setItem(STORAGE_KEYS.CACHED_ITEMS, JSON.stringify(items));
  } catch (err) {
    console.warn("Catalog caching warning:", err);
  }
}

export function getCachedCatalogItems(): any[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.CACHED_ITEMS);
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    return [];
  }
}

/**
 * Cache Customers list for offline autocomplete
 */
export function cacheCustomers(customers: any[]): void {
  if (typeof window === "undefined" || !Array.isArray(customers)) return;
  try {
    localStorage.setItem(STORAGE_KEYS.CACHED_CUSTOMERS, JSON.stringify(customers));
  } catch (err) {
    console.warn("Customer caching warning:", err);
  }
}

export function getCachedCustomers(): any[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.CACHED_CUSTOMERS);
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    return [];
  }
}

/**
 * Upload and sync all pending offline invoices with MongoDB backend
 */
export async function syncOfflineInvoices(): Promise<{ synced: number; failed: number }> {
  const queue = getOfflineInvoices();
  if (queue.length === 0) return { synced: 0, failed: 0 };

  let synced = 0;
  let failed = 0;

  for (const inv of queue) {
    try {
      const payload = {
        ...inv,
        // Backend handles offlineId check
      };

      const res = await fetch("/api/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = await res.json();
      if (json.success || (json.error && json.error.includes("already exists"))) {
        removeOfflineInvoice(inv.offlineId);
        synced++;
      } else {
        failed++;
      }
    } catch (err) {
      console.error(`Sync failed for offline invoice ${inv.invoiceNumber}:`, err);
      failed++;
    }
  }

  // Trigger UI refresh
  if (synced > 0 && typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("erp-invoice-created"));
  }

  return { synced, failed };
}
