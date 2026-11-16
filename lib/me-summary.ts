/**
 * "My status" — what the pop-ups and the bell on every page need when the app opens, in one call
 * (GET /api/me/summary) instead of one call each. Plain functions shared by the route and the
 * screens, so both agree on who gets which part, and which live-update paths refresh it.
 *
 * Each part is given only to the roles whose screen shows it — the same role lists those
 * components used before to decide whether to fetch at all. The route still runs each part through
 * the original route's own checks, so this list can only narrow access, never widen it.
 */

export type SummarySection =
  | "notifications"
  | "approvals"
  | "estimates"
  | "leaves"
  | "discounts"
  | "dayClose"
  | "financeReminders"
  | "leadShareInbox";

const ADMINS = ["admin", "superadmin"];

/** Which roles get each part ("all" = anyone signed in). */
export const SECTION_ROLES: Record<SummarySection, string[] | "all"> = {
  // The bell and the unread pop-up: everyone's own notifications.
  notifications: "all",
  // The bell's "approvals waiting" count: Admin only.
  approvals: ADMINS,
  // PendingEstimatePopup: estimates a salesman sent for billing.
  estimates: ["cashier", "manager", ...ADMINS],
  // PendingLeavePopup: leave / break requests this person may decide.
  leaves: [...ADMINS, "manager"],
  // PendingDiscountPopup: discount requests this person may decide.
  discounts: [...ADMINS, "manager", "cashier"],
  // DayCloseGate: the nightly cash count.
  dayClose: ["cashier", "accounts"],
  // FinancePayoutReminder: payouts missing a bank account / UTR.
  financeReminders: ["admin", "manager", "accounts"],
  // LeadShareInbox: leads another salesman shared with this one.
  leadShareInbox: ["salesman", "sales"],
};

/** The API paths whose changes each part depends on (what each component used to watch). */
export const SECTION_LIVE_PATHS: Record<SummarySection, string[]> = {
  notifications: ["/api/notifications"],
  approvals: ["/api/approvals"],
  estimates: ["/api/estimates"],
  leaves: ["/api/staff/leave-requests"],
  discounts: ["/api/discount-approvals"],
  dayClose: ["/api/day-close"],
  financeReminders: ["/api/finance", "/api/invoices"],
  leadShareInbox: ["/api/crm/leads", "/api/notifications"],
};

const ALL_SECTIONS = Object.keys(SECTION_ROLES) as SummarySection[];

export function summarySectionsForRole(role: string): SummarySection[] {
  const r = String(role || "").toLowerCase();
  if (!r) return [];
  return ALL_SECTIONS.filter((s) => {
    const roles = SECTION_ROLES[s];
    return roles === "all" || roles.includes(r);
  });
}

export function roleHasSection(role: string, section: SummarySection): boolean {
  return summarySectionsForRole(role).includes(section);
}

/** `meta.live` for the summary query of this role: the union of its parts' paths, always with notifications. */
export function summaryLivePaths(role: string): string[] {
  const paths = new Set<string>(["/api/notifications"]);
  for (const s of summarySectionsForRole(role)) SECTION_LIVE_PATHS[s].forEach((p) => paths.add(p));
  return Array.from(paths);
}

export interface MeSummary {
  role: string;
  /** Latest 30 of this person's notifications + their unread count (as GET /api/notifications). */
  notifications?: { data: any[]; unreadCount: number } | null;
  approvals?: { pendingCount: number } | null;
  estimates?: any[] | null;
  leaves?: any[] | null;
  discounts?: any[] | null;
  dayClose?: { pendingDate: string | null } | null;
  financeReminders?: any[] | null;
  leadShareInbox?: any[] | null;
}

/** What each part's original route answered (its JSON body), or a thrown/failed result as null. */
export type RawSummaryParts = Partial<Record<SummarySection, any>>;

const pick = (row: any, keys: string[]) => {
  const out: any = {};
  for (const k of keys) if (row?.[k] !== undefined) out[k] = row[k];
  return out;
};
const listOf = (json: any): any[] | null => (json && json.success && Array.isArray(json.data) ? json.data : null);

// Only the fields each pop-up shows: a whole estimate (all its lines) or lead is many times larger.
const ESTIMATE_FIELDS = ["_id", "estimateNumber", "total", "customerName", "salesperson", "salesExecutive"];
const LEAVE_FIELDS = ["_id", "staffName", "staffRole", "kind", "breakMinutes", "fromDate", "toDate", "days", "reason"];
const DISCOUNT_FIELDS = [
  "_id", "itemName", "brand", "percent", "quantity", "context", "customerName",
  "sellingPrice", "price", "requestedBy", "requestedByRole", "tier", "vsp", "purchasePrice",
];
const LEAD_FIELDS = ["_id", "customerName", "mobile", "interestedProduct", "assignedStaff"];

/**
 * Builds the answer from what each original route returned. A part the role may not see is left
 * out even if it was somehow fetched; a part whose route failed is null (the screen then keeps what
 * it had, as it did when its own call failed).
 */
export function shapeMeSummary(role: string, actorId: string, raw: RawSummaryParts): MeSummary {
  const out: MeSummary = { role: String(role || "").toLowerCase() };
  for (const s of summarySectionsForRole(role)) {
    const json = raw[s];
    switch (s) {
      case "notifications":
        out.notifications =
          json && json.success && Array.isArray(json.data) ? { data: json.data, unreadCount: Number(json.unreadCount) || 0 } : null;
        break;
      case "approvals":
        out.approvals = typeof json === "number" && Number.isFinite(json) ? { pendingCount: json } : null;
        break;
      case "estimates": {
        const list = listOf(json);
        out.estimates = list ? list.map((e) => pick(e, ESTIMATE_FIELDS)) : null;
        break;
      }
      case "leaves": {
        const list = listOf(json);
        out.leaves = list ? list.map((r) => pick(r, LEAVE_FIELDS)) : null;
        break;
      }
      case "discounts": {
        const list = listOf(json);
        out.discounts = list ? list.map((r) => pick(r, DISCOUNT_FIELDS)) : null;
        break;
      }
      case "dayClose":
        out.dayClose = json && typeof json === "object" && "pendingDate" in json ? { pendingDate: json.pendingDate ?? null } : null;
        break;
      case "financeReminders":
        out.financeReminders = listOf(json);
        break;
      case "leadShareInbox": {
        const list = listOf(json);
        // Only this person's own share entry is shown; the others' are not sent.
        out.leadShareInbox = list
          ? list.map((l) => ({
              ...pick(l, LEAD_FIELDS),
              sharedWith: (Array.isArray(l.sharedWith) ? l.sharedWith : []).filter((x: any) => String(x?.staffId) === String(actorId)),
            }))
          : null;
        break;
      }
    }
  }
  return out;
}
