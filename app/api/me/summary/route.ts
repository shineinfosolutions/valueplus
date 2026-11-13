import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import { getActor } from "@/lib/requirePermission";
import { ADMIN_ROLES } from "@/lib/change-requests";
import StoreActivityApproval from "@/models/StoreActivityApproval";
import { getPendingDayCloseDate } from "@/lib/day-close-pending";
import { shapeMeSummary, summarySectionsForRole, type RawSummaryParts, type SummarySection } from "@/lib/me-summary";
import { GET as getNotifications } from "@/app/api/notifications/route";
import { GET as getEstimates } from "@/app/api/estimates/route";
import { GET as getLeaveRequests } from "@/app/api/staff/leave-requests/route";
import { GET as getDiscountApprovals } from "@/app/api/discount-approvals/route";
import { GET as getFinanceReminders } from "@/app/api/finance/reminders/route";
import { GET as getLeads } from "@/app/api/crm/leads/route";

export const dynamic = "force-dynamic";

/**
 * GET /api/me/summary — everything the bell and the pop-ups on every page need when the app
 * opens, for the signed-in user, in one call instead of about eight (see lib/me-summary.ts).
 *
 * Each part is answered by the original route's own handler (same query, same filters, same
 * role checks — e.g. the discount requests are only the tiers this person may decide), called
 * here inside this request rather than over the network. The two exceptions read the same
 * data more cheaply, under the same rule:
 *   - approvals: only the pending count, with the query /api/approvals uses for an Admin
 *     (the bell never showed the list);
 *   - day close: only the pending date, by the rule /api/day-close uses (lib/day-close-pending).
 * A part is computed only for the roles whose screen shows it (SECTION_ROLES); one part failing
 * leaves just that part empty (null), as its own call failing did before.
 */
export async function GET(req: Request) {
  try {
    const actor = await getActor();
    if (!actor?.id) return NextResponse.json({ success: false, error: "Not signed in" }, { status: 401 });
    await connectToDatabase();

    const origin = new URL(req.url).origin;
    // A request to hand to the original handler: same cookies, its own URL and query.
    const sub = (path: string) => new Request(`${origin}${path}`, { headers: req.headers });
    const body = async (res: Response) => res.json().catch(() => null);

    const loaders: Record<SummarySection, () => Promise<any>> = {
      notifications: async () => body(await getNotifications()),
      approvals: async () => {
        // /api/approvals?status=pending for an Admin: { status: "pending" } over every request.
        if (!ADMIN_ROLES.includes(actor.role)) return null;
        return StoreActivityApproval.countDocuments({ status: "pending" });
      },
      estimates: async () => body(await getEstimates(sub("/api/estimates?approval=pending"))),
      leaves: async () => body(await getLeaveRequests(sub("/api/staff/leave-requests?status=pending&decidable=1"))),
      discounts: async () => body(await getDiscountApprovals(sub("/api/discount-approvals?status=pending"))),
      dayClose: async () => ({ pendingDate: await getPendingDayCloseDate() }),
      financeReminders: async () => body(await getFinanceReminders()),
      leadShareInbox: async () => body(await getLeads(sub("/api/crm/leads?shareInbox=1"))),
    };

    const sections = summarySectionsForRole(actor.role);
    const raw: RawSummaryParts = {};
    await Promise.all(
      sections.map(async (s) => {
        try {
          raw[s] = await loaders[s]();
        } catch (e: any) {
          console.warn(`me/summary: ${s} failed:`, e?.message || e);
          raw[s] = null;
        }
      })
    );

    return NextResponse.json({ success: true, data: shapeMeSummary(actor.role, actor.id, raw) });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
