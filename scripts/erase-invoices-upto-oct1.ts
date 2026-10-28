/**
 * One-time bulk cleanup: erase every tax-invoice dated 2026-10-01 or earlier,
 * per the owner's explicit request (pre-live-launch test/old data cleanup).
 *
 * Mirrors the app's own single-invoice DELETE route (app/api/invoices/route.ts)
 * exactly, just looped over every matching invoice instead of one:
 *   1. Archive the full invoice into DeletedInvoice (recoverable, not destroyed —
 *      same safety net a manual delete already gets).
 *   2. Reverse the customer's outstandingBalance by the invoice's balanceAmount.
 *   3. Reverse the stock this invoice deducted, back into the same warehouse.
 *   4. Delete the Invoice document.
 * PaymentTransaction records tied to the invoice are left alone, matching the
 * existing single-delete route's own behaviour (it doesn't touch them either).
 *
 * Usage:
 *   npx tsx scripts/erase-invoices-upto-oct1.ts            (dry run)
 *   npx tsx scripts/erase-invoices-upto-oct1.ts --apply
 */
import connectToDatabase from "../lib/db";
import Invoice from "../models/Invoice";
import Customer from "../models/Customer";
import DeletedInvoice from "../models/DeletedInvoice";
import { applyStockMovement } from "../lib/stock";

const CUTOFF_DATE = "2026-10-01"; // inclusive

async function main() {
  const apply = process.argv.includes("--apply");
  await connectToDatabase();

  const invoices = await Invoice.find({
    type: "tax-invoice",
    date: { $lte: CUTOFF_DATE },
  }).lean();

  console.log(`${invoices.length} tax-invoice(s) dated on or before ${CUTOFF_DATE} found.\n`);

  if (invoices.length === 0) {
    console.log("Nothing to erase.");
    process.exit(0);
  }

  const totalValue = invoices.reduce((sum: number, inv: any) => sum + (Number(inv.total) || 0), 0);
  const totalBalance = invoices.reduce((sum: number, inv: any) => sum + (Number(inv.balanceAmount) || 0), 0);
  const totalItemLines = invoices.reduce((sum: number, inv: any) => sum + (inv.items?.length || 0), 0);

  console.table(
    invoices.slice(0, 25).map((inv: any) => ({
      invoiceNumber: inv.invoiceNumber,
      date: inv.date,
      customer: inv.customerName,
      total: inv.total,
      balance: inv.balanceAmount,
      items: inv.items?.length || 0,
    }))
  );
  if (invoices.length > 25) console.log(`...and ${invoices.length - 25} more (showing first 25).`);

  console.log(
    `\nTotals — invoices: ${invoices.length}, combined value: ₹${totalValue.toFixed(2)}, combined outstanding balance to reverse: ₹${totalBalance.toFixed(2)}, item lines to reverse into stock: ${totalItemLines}.`
  );

  if (!apply) {
    console.log("\nDry run only — re-run with --apply to actually erase these invoices.");
    process.exit(0);
  }

  let erased = 0;
  for (const inv of invoices as any[]) {
    const invoice = await Invoice.findById(inv._id);
    if (!invoice) continue; // already gone somehow

    const snapshot = invoice.toObject();

    await DeletedInvoice.create({
      ...snapshot,
      _id: undefined,
      invoiceNumber: invoice.invoiceNumber,
      docType: "Invoice",
      customerName: invoice.customerName,
      total: Number(invoice.total) || 0,
      deletedAt: new Date(),
      deletedBy: "System Bulk Cleanup",
      deletedByRole: "admin",
      deleteReason: `Bulk erase of pre-${CUTOFF_DATE} invoices per owner request`,
      pinVerified: false,
      snapshot,
    });

    if (invoice.balanceAmount > 0 && invoice.customerId) {
      await Customer.findByIdAndUpdate(invoice.customerId, {
        $inc: { outstandingBalance: -invoice.balanceAmount },
      });
    }

    if (invoice.items && invoice.items.length > 0) {
      const reversalWarehouseId = invoice.warehouseId ? String(invoice.warehouseId) : null;
      for (const item of invoice.items) {
        if (item.itemId) {
          await applyStockMovement(item.itemId, reversalWarehouseId, item.quantity);
        }
      }
    }

    await Invoice.findByIdAndDelete(invoice._id);
    erased += 1;
  }

  console.log(`\nApplied. ${erased} invoice(s) erased and archived to deleted_invoices.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
