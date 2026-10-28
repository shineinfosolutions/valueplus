import Invoice from "@/models/Invoice";
import { notifyAdmins, notifyAssignee } from "@/lib/notify";

/**
 * "Delivery due soon" reminders for bills whose goods are handed over later.
 *
 * There is no scheduler on the server, so this runs whenever anyone's bell
 * checks for notifications — at most once a minute per server instance. A bill
 * is reminded once, when its expected delivery date is within REMIND_DAYS and
 * the goods are not delivered yet; it goes to every admin and to the bill's
 * sales executive.
 */

const REMIND_DAYS = 2;
const MIN_GAP_MS = 60_000;
let lastRun = 0;

const istDate = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);

export async function sendDueDeliveryReminders(): Promise<number> {
  if (Date.now() - lastRun < MIN_GAP_MS) return 0;
  lastRun = Date.now();
  try {
    const today = new Date();
    const until = istDate(new Date(today.getTime() + REMIND_DAYS * 86_400_000));
    const due: any[] = await Invoice.find(
      {
        expectedDeliveryDate: { $nin: ["", null], $lte: until },
        deliveryStatus: { $ne: "delivered" },
        status: { $ne: "cancelled" },
        deliveryReminderSentAt: { $exists: false },
      },
      { invoiceNumber: 1, customerName: 1, customerPhone: 1, expectedDeliveryDate: 1, salesExecutive: 1, deliveryNote: 1, items: 1 }
    )
      .limit(50)
      .lean();

    let sent = 0;
    for (const inv of due) {
      // Claim it first, so two servers checking at once do not both remind.
      const claimed = await Invoice.updateOne(
        { _id: inv._id, deliveryReminderSentAt: { $exists: false } },
        { $set: { deliveryReminderSentAt: new Date() } }
      );
      if (!claimed.modifiedCount) continue;

      const overdue = inv.expectedDeliveryDate < istDate(today);
      const what = (inv.items || []).map((l: any) => l.itemName).filter(Boolean).slice(0, 2).join(", ");
      const note = {
        type: "general" as const,
        title: `🚚 ${overdue ? "Delivery overdue" : "Delivery due"}: ${inv.invoiceNumber} — ${inv.customerName}`,
        message: `${overdue ? "Was due" : "Due"} on ${inv.expectedDeliveryDate}. ${what}${inv.customerPhone ? ` · ${inv.customerPhone}` : ""}${
          inv.deliveryNote ? ` · ${inv.deliveryNote}` : ""
        }`,
        link: "/sales/dispatch",
        createdBy: "Delivery reminder",
      };
      await notifyAdmins(note);
      if (inv.salesExecutive) await notifyAssignee(inv.salesExecutive, undefined, note);
      sent++;
    }
    return sent;
  } catch (e) {
    console.warn("Notice: delivery reminders skipped:", e);
    return 0;
  }
}
