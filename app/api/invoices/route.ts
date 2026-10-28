import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { getServerSession } from "next-auth";
import connectToDatabase from "@/lib/db";
import Invoice from "@/models/Invoice";
import Customer from "@/models/Customer";
import Warehouse from "@/models/Warehouse";
import Estimate from "@/models/Estimate";
import DeletedInvoice from "@/models/DeletedInvoice";
import AuditLog from "@/models/AuditLog";
import { derivePaymentModeLabel, isCollectedMode, isFinanceInvoice, classifyPaymentMode } from "@/lib/payment-modes";
import { derivePanFromGstin } from "@/lib/gst";
import { getActor } from "@/lib/requirePermission";
import { authoriseDestructiveAction } from "@/lib/destructiveAction";
import { applyStockMovement } from "@/lib/stock";
import authOptions from "@/lib/authOptions";
import Item from "@/models/Item";
import { BILLING_ENTITIES, entityOf, entityLabel, invoiceSeriesOf } from "@/lib/billing-entity";
import { stampLineCosts } from "@/lib/sale-cost";
import { fullEditInvoice } from "@/lib/invoice-full-edit";

/** The next unused number in a series, read from what is actually stored. */
async function nextNumberInSeries(prefix: string, width: number): Promise<string> {
  const siblings = await Invoice.find(
    { invoiceNumber: { $regex: `^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\d+` } },
    { invoiceNumber: 1 }
  ).lean();
  let max = 0;
  for (const s of siblings as any[]) {
    const d = String(s.invoiceNumber).slice(prefix.length).match(/^\d+/);
    if (d) max = Math.max(max, parseInt(d[0], 10) || 0);
  }
  return `${prefix}${String(max + 1).padStart(width, "0")}`;
}

/**
 * Which warehouse a sale's stock comes out of. A role without switch rights
 * is trusted against their own server-side assignment, not whatever a client
 * happens to send — the sidebar already shows this as a locked location, this
 * is what actually enforces it for stock. Admin / switch-permitted roles use
 * whatever warehouse the client sent (the one they're actively operating as,
 * from BranchContext). Falls back to null (today's warehouse-blind behaviour)
 * when nothing resolves, rather than blocking the sale over it.
 */
async function resolveSaleWarehouseId(body: any): Promise<string | null> {
  const session = await getServerSession(authOptions);
  const user: any = session?.user;
  const canChoose = !user || user.role === "admin" || user.assignedWarehouseName === "ALL" || user.canSwitchWarehouse;

  if (!canChoose && user?.assignedWarehouseId && mongoose.isValidObjectId(user.assignedWarehouseId)) {
    return String(user.assignedWarehouseId);
  }
  if (body.warehouseId && mongoose.isValidObjectId(body.warehouseId)) {
    return String(body.warehouseId);
  }
  const nameToMatch = !canChoose ? user?.assignedWarehouseName : body.warehouse;
  if (nameToMatch) {
    const escaped = String(nameToMatch).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const matched = await Warehouse.findOne({ name: { $regex: new RegExp(`^${escaped}$`, "i") } }).lean();
    if (matched) return String((matched as any)._id);
  }
  return null;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const type = searchParams.get("type");
    const warehouse = searchParams.get("warehouse") || searchParams.get("location");
    
    await connectToDatabase();
    
    // An estimate is saved beside invoices as type "proforma", but it is a
    // quotation, not a sale. Every sales screen and report reads this list, so
    // estimates are left out unless they are asked for by name: they used to show
    // up as bills in the invoice list, in the reports and in salesman incentives.
    const includeEstimates = searchParams.get("includeEstimates") === "true";
    const query: any = type
      ? { type }
      : { type: { $nin: includeEstimates ? ["sales-order"] : ["sales-order", "proforma"] } };

    // Invoices are not tagged with a warehouse anywhere in the billing flow, so a
    // strict location filter matched nothing and returned an empty list — the branch
    // selector defaults to "Main Central Warehouse", which hid every bill in the app.
    // Filter only when it actually selects something; otherwise show the full ledger.
    const SHOWROOM_PATTERN = /showroom|ashoka|kunraghat|vp-?kun|main\s*store/i;
    let warehouseScoped = false;

    if (warehouse && warehouse !== "all") {
      const escaped = warehouse.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const locationClause = SHOWROOM_PATTERN.test(warehouse)
        ? [
            { warehouse: { $exists: false } },
            { warehouse: "" },
            { warehouse: null },
            { warehouse: { $regex: SHOWROOM_PATTERN } },
          ]
        : [
            { warehouse: { $regex: new RegExp(`^${escaped}$`, "i") } },
            { branchName: { $regex: new RegExp(`^${escaped}$`, "i") } },
          ];

      const scopedCount = await Invoice.countDocuments({ ...query, $or: locationClause });
      if (scopedCount > 0) {
        query.$or = locationClause;
        warehouseScoped = true;
      }
    }

    const invoices = await Invoice.find(query).sort({ createdAt: -1 }).lean();
    return NextResponse.json({
      success: true,
      data: invoices,
      warehouseScoped,
      warehouseRequested: warehouse || "all",
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    await connectToDatabase();
    
    // 0a. Bill date. Today (India time) for everyone; an earlier date only for the
    // Admin or the Store Manager — and a Store Manager's back-dated bill goes to
    // the Admin for approval. A bill made offline and synced later keeps the day
    // it was made, so it is not treated as back-dated.
    const todayIst = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
    const billDay = String(body.date || "").slice(0, 10);
    let backdateNeedsApproval: { by: string } | null = null;
    if (body.type !== "proforma" && /^\d{4}-\d{2}-\d{2}$/.test(billDay) && billDay !== todayIst && !body.offlineId) {
      if (billDay > todayIst) {
        return NextResponse.json({ success: false, error: "A bill cannot be dated in the future." }, { status: 400 });
      }
      const dateActor = await getActor();
      const dateRole = String(dateActor?.role || "");
      if (!dateActor || !["admin", "superadmin", "manager"].includes(dateRole)) {
        return NextResponse.json(
          { success: false, error: "Only the Admin or the Store Manager can make a bill with an earlier date." },
          { status: 403 }
        );
      }
      body.backdateMadeOn = todayIst;
      if (dateRole === "manager") {
        body.backdateStatus = "pending";
        body.backdateRequestedBy = dateActor.name;
        backdateNeedsApproval = { by: dateActor.name };
      } else {
        body.backdateStatus = "approved";
      }
    }

    // 0. Billing entity. A bill is raised under Value Plus or Ashoka Enterprises
    // and may only carry that one's products — the form filters the product list,
    // and this is what actually enforces it.
    const entity = entityOf(body.billingEntity);
    body.billingEntity = entity;
    const lineItemIds = (Array.isArray(body.items) ? body.items : [])
      .map((it: any) => it?.itemId)
      .filter((id: any) => mongoose.isValidObjectId(id));
    if (lineItemIds.length > 0) {
      const products = await Item.find({ _id: { $in: lineItemIds } }, { name: 1, billingEntity: 1 }).lean();
      const others = (products as any[]).filter((p) => entityOf(p) !== entity);
      if (others.length > 0) {
        return NextResponse.json(
          {
            success: false,
            error: `This bill is for ${entityLabel(entity)}, but these products belong to ${entityLabel(others[0])}: ${others
              .map((p) => p.name)
              .join(", ")}. Remove them or bill them separately.`,
          },
          { status: 400 }
        );
      }
    }

    // 1. Customer Auto-Add Logic & Offline Sync Reconciliation
    //
    // A problem here must never lose the bill. Previously an exception thrown while
    // creating the customer (an address field failing validation, a duplicate code
    // under concurrent billing) propagated out and failed the whole POST with a 400,
    // so the invoice was never written even though the counter had taken the money.
    if (body.customerId === "new" || !body.customerId || body.customerId.startsWith("OFFLINE-CUST-")) {
      try {
        let matchedCust = body.customerPhone ? await Customer.findOne({ phone: body.customerPhone }) : null;
        if (!matchedCust) {
          // Derive the code from the highest existing one rather than the document
          // count, so a deleted customer can't cause a duplicate-key collision.
          const last = await Customer.findOne({ code: /^CUST-\d+$/ }).sort({ code: -1 }).lean();
          const lastNum = last?.code ? parseInt(String(last.code).replace("CUST-", ""), 10) || 0 : 0;
          const custCode = `CUST-${String(lastNum + 1).padStart(3, "0")}`;

          matchedCust = await Customer.create({
            code: custCode,
            name: body.customerName || "Walk-in Customer",
            phone: body.customerPhone || "0000000000",
            email: body.customerEmail || "",
            gstNumber: body.customerGST || "",
            billingAddress: {
              line1: body.customerAddress || "Address not provided",
              city: body.customerCity || "City Not Specified",
              state: body.placeOfSupply ? body.placeOfSupply.replace(/ —.*$/, '').replace(/ \(\d+\)/, '').trim() : "Unknown",
              pincode: body.customerPin || "",
              country: "India"
            }
          });
        }
        body.customerId = matchedCust._id.toString();
      } catch (custErr: any) {
        // Fall back to a synthetic id so the sale is still recorded; the bill matters
        // more than the customer master row, and the name/phone are on the invoice.
        console.error("Customer auto-add failed, saving invoice anyway:", custErr?.message);
        body.customerId = body.customerId && !String(body.customerId).startsWith("OFFLINE-CUST-")
          ? body.customerId
          : new mongoose.Types.ObjectId().toString();
      }
    }
    
    // 2. Number collision handling.
    //
    // This dedupe exists so an offline bill re-posted on reconnect isn't duplicated.
    // But it used to return the stored invoice for ANY number match, so when the
    // client generated a number that already existed the counter got {success:true}
    // plus somebody else's older bill — the new sale was silently discarded and
    // never appeared in the list or on the dashboard.
    //
    // A genuine resync is the same bill: same customer, same amount, same date.
    // Anything else is a fresh sale that merely collided, and must get its own
    // number rather than being thrown away.
    let numberReassignedFrom: string | null = null;
    const existingInvoice: any = await Invoice.findOne({ invoiceNumber: body.invoiceNumber }).lean();
    if (existingInvoice) {
      const sameBill =
        String(existingInvoice.customerPhone || "") === String(body.customerPhone || "") &&
        Math.abs(Number(existingInvoice.total || 0) - Number(body.total || 0)) < 1 &&
        String(existingInvoice.date || "").slice(0, 10) === String(body.date || "").slice(0, 10);

      if (sameBill) {
        return NextResponse.json({ success: true, data: existingInvoice, message: "Invoice already synced" });
      }

      // Collision: allocate the next free number from the database. A known
      // series is recognised by its prefix; guessing the prefix from the shape of
      // the number would read "INV2026-0001" as prefix "INV" + number 2026.
      const series = invoiceSeriesOf(body.invoiceNumber);
      const prefixMatch = String(body.invoiceNumber || "").match(/^([A-Za-z0-9-]*?)(\d+)(-\d+)?$/);
      const prefix = series ? series.invoicePrefix : prefixMatch ? prefixMatch[1] : "SVAK2026RI";
      const width = series ? series.invoicePad : prefixMatch ? prefixMatch[2].length : 5;
      const reassigned = await nextNumberInSeries(prefix, width);
      console.warn(
        `Invoice number ${body.invoiceNumber} already belongs to a different bill; reassigned to ${reassigned}`
      );
      numberReassignedFrom = body.invoiceNumber;
      body.invoiceNumber = reassigned;
    }

    // A tax invoice must be numbered in its own entity's series. If the number
    // sent belongs to the other one (the entity was switched after the form had
    // already fetched a number), it is replaced rather than saved in the wrong book.
    if ((body.type || "tax-invoice") === "tax-invoice") {
      const numberSeries = invoiceSeriesOf(body.invoiceNumber);
      if (numberSeries && numberSeries.key !== entity) {
        const own = BILLING_ENTITIES[entity];
        numberReassignedFrom = numberReassignedFrom || body.invoiceNumber;
        body.invoiceNumber = await nextNumberInSeries(own.invoicePrefix, own.invoicePad);
      }
    }

    // Generate 4-digit Delivery OTP if delayed delivery is chosen
    if (body.dispatchType === "delayed_delivery" && !body.deliveryOtp) {
      body.deliveryOtp = Math.floor(1000 + Math.random() * 9000).toString();
      body.deliveryStatus = "pending_dispatch";
    }

    // ─── SPLIT PAYMENT NORMALISATION ────────────────────────────────────────
    // A bill can be settled across several modes (₹10,000 cash + ₹40,000 online).
    // The rows are the source of truth, so paymentMode/paidAmount/balanceAmount are
    // derived here rather than trusted from the client. Invoices posted without a
    // `payments` array are untouched and behave exactly as before.
    const splitRows = Array.isArray(body.payments)
      ? body.payments
          .map((p: any) => ({
            mode: String(p?.mode || "Cash"),
            amount: Math.max(0, Number(p?.amount) || 0),
            txnId: p?.txnId || "",
            reference: p?.reference || "",
            receivedBy: p?.receivedBy || "",
            notes: p?.notes || "",
          }))
          .filter((p: any) => p.amount > 0)
      : [];

    const isSplitInvoice = splitRows.length > 1;

    if (splitRows.length > 0) {
      const invoiceTotal = Number(body.total) || 0;
      const allocated = splitRows.reduce((s: number, p: any) => s + p.amount, 0);
      // Allow a rupee of tolerance for GST rounding, but reject a genuine mismatch
      // rather than silently saving a bill whose parts do not add up.
      if (Math.abs(allocated - invoiceTotal) > 1) {
        return NextResponse.json(
          {
            success: false,
            error: `Split payments (₹${allocated.toFixed(2)}) do not match the invoice total (₹${invoiceTotal.toFixed(2)}).`,
          },
          { status: 400 }
        );
      }

      body.payments = splitRows;
      body.paymentMode = derivePaymentModeLabel(splitRows);
      // Only Cash/UPI/Card/Online are money in hand. Finance and Due rows are
      // receivables and stay in the balance, matching how financeDownPayment and
      // dueAdvanceAmount have always behaved.
      const collected = splitRows
        .filter((p: any) => isCollectedMode(p.mode))
        .reduce((s: number, p: any) => s + p.amount, 0);
      body.paidAmount = collected;
      body.balanceAmount = Math.max(0, invoiceTotal - collected);
      if (body.balanceAmount <= 1 && collected > 0) body.status = body.status === "draft" ? "draft" : "paid";
      else if (collected > 0) body.status = body.status === "draft" ? "draft" : "partial";
    }

    // PAN is derived from the GSTIN itself (its own 3rd-12th characters), not
    // collected as a separate manual field — and a GST-registered company is
    // remembered by its GSTIN so it shows up in the billing form's dropdown
    // next time instead of being retyped. Never lets a bad company-master
    // write fail the actual sale.
    if (body.customerGST) {
      body.customerPAN = body.customerPAN || derivePanFromGstin(body.customerGST);
      if (body.customerCompanyName) {
        try {
          const BillingCompany = (await import("@/models/BillingCompany")).default;
          await BillingCompany.findOneAndUpdate(
            { gstin: String(body.customerGST).trim().toUpperCase() },
            {
              $set: { companyName: body.customerCompanyName, pan: body.customerPAN },
              $inc: { usageCount: 1 },
            },
            { upsert: true, setDefaultsOnInsert: true }
          );
        } catch (companyErr: any) {
          console.error("BillingCompany upsert failed, saving invoice anyway:", companyErr?.message);
        }
      }
    }

    const resolvedWarehouseId = await resolveSaleWarehouseId(body);
    if (resolvedWarehouseId) body.warehouseId = resolvedWarehouseId;
    else delete body.warehouseId;

    // Each line keeps the product's purchase price as of today, for the P&L.
    if (Array.isArray(body.items)) body.items = await stampLineCosts(body.items);

    // Set from the customer's real balance after the invoice is saved (step 7.9),
    // never taken from the request as-is.
    const creditRequested = Math.max(0, Number(body.creditAdjusted) || 0);
    delete body.creditAdjusted;

    const invoice = await Invoice.create(body);

    // A Store Manager's back-dated bill: the Admin is asked to approve it.
    if (backdateNeedsApproval) {
      try {
        const StoreActivityApproval = (await import("@/models/StoreActivityApproval")).default;
        const { notifyAdmins } = await import("@/lib/notify");
        await StoreActivityApproval.create({
          activityId: `ACT-${new Date().getFullYear()}-${Date.now().toString().slice(-4)}-${Math.floor(100 + Math.random() * 900)}`,
          storeName: (invoice as any).warehouse || "Store",
          storeInchargeName: backdateNeedsApproval.by,
          storeInchargeEmail: (await getActor())?.email || "",
          activityType: "general",
          title: `Back-dated bill ${invoice.invoiceNumber} (${invoice.date})`,
          description: `${invoice.customerName} · ₹${Number(invoice.total || 0).toLocaleString("en-IN")} · dated ${invoice.date}, made on ${body.backdateMadeOn}`,
          amount: Number(invoice.total) || 0,
          payload: { kind: "backdated_invoice", invoiceNumber: invoice.invoiceNumber, date: invoice.date, madeOn: body.backdateMadeOn },
          status: "pending",
        });
        await notifyAdmins({
          type: "approval_request",
          title: `🔔 Approve back-dated bill ${invoice.invoiceNumber}`,
          message: `${backdateNeedsApproval.by} dated it ${invoice.date} (made on ${body.backdateMadeOn}) · ${invoice.customerName} · ₹${Number(invoice.total || 0).toLocaleString("en-IN")}`,
          link: "/admin/approvals",
          createdBy: backdateNeedsApproval.by,
        });
      } catch (approvalErr) {
        console.warn("Notice: back-date approval request:", approvalErr);
      }
    }

    try {
      // 2.5 Create Payment Transaction if paidAmount > 0
      //
      // Skipped for split invoices: the per-mode breakdown already lives on the
      // invoice, and a single receipt could only carry one mode ("Multiple"), which
      // the dashboard's receipt loop would bucket entirely as Online. Single-mode
      // invoices still create their receipt exactly as before.
      if (body.paidAmount > 0 && !isSplitInvoice) {
        const PaymentTransaction = (await import("@/models/PaymentTransaction")).default;
        await PaymentTransaction.create({
          transactionId: `TXN-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          partyId: invoice.customerId,
          partyType: "Customer",
          partyName: invoice.customerName,
          amount: body.paidAmount,
          // For a Finance sale, the amount actually collected here is the customer's down
          // payment — tag it with however that down payment was really collected, not "Finance".
          paymentMode: body.financeProvider ? (body.financeDownPaymentMode || body.downPaymentMode || "Unclassified") : (body.paymentMode || "Unclassified"),
          date: body.date || new Date().toISOString().split("T")[0],
          referenceId: invoice.invoiceNumber,
          notes: invoice.type === 'credit-note' ? `Refund for Credit Note ${invoice.invoiceNumber}` : `Initial payment for ${invoice.type === 'sales-order' ? 'order' : 'invoice'} ${invoice.invoiceNumber}`,
          type: invoice.type === 'credit-note' ? "paid" : "received"
        });
      }
      
      // 3. Update Customer Balance and Master Data
      // An estimate (proforma) is a quotation, not a sale: whatever it "leaves
      // unpaid" is not money the customer owes, so it never touches their balance.
      const updateData: any = {};
      if (body.balanceAmount > 0 && body.type !== "proforma") {
        updateData.$inc = { 
          outstandingBalance: body.type === "credit-note" ? -body.balanceAmount : body.balanceAmount 
        };
      }
      
      if (body.customerId && body.customerId !== "new" && body.customerPin) {
        if (!updateData.$set) updateData.$set = {};
        updateData.$set["billingAddress.pincode"] = body.customerPin;
      }

      if (Object.keys(updateData).length > 0) {
        await Customer.findByIdAndUpdate(body.customerId, updateData);
      }

      // 4. Inventory Stock Deduction & Serial Number Status Update
      if (body.type !== "proforma") {
        if (body.items && body.items.length > 0) {
          for (const item of body.items) {
            // Deduct / add stock
            if (item.itemId && (item.itemId.length === 24 || item.itemId.length > 10)) {
              const delta = body.type === "credit-note" ? item.quantity : -item.quantity;
              await applyStockMovement(item.itemId, resolvedWarehouseId, delta);
            }

            // Lock Serial Number if serialized item was sold
            if (item.serialNumber && body.type !== "credit-note") {
              const SerialNumber = (await import("@/models/SerialNumber")).default;
              await SerialNumber.findOneAndUpdate(
                { serialNumber: item.serialNumber },
                {
                  status: "SOLD",
                  invoiceId: invoice._id.toString(),
                  invoiceNumber: invoice.invoiceNumber,
                  customerName: invoice.customerName,
                  customerPhone: invoice.customerPhone || "",
                  soldDate: invoice.date,
                  $push: {
                    history: {
                      action: "Sold via Tax Invoice",
                      date: new Date(),
                      performedBy: invoice.salesExecutive || "Sales Team",
                      details: `Invoice #${invoice.invoiceNumber}`,
                    },
                  },
                }
              );
            }

            // Record Extended Warranty if purchased
            if (item.extendedWarrantyPlan && (item.extendedWarrantyAmount || 0) > 0) {
              const ExtendedWarranty = (await import("@/models/ExtendedWarranty")).default;
              const duration = item.extendedWarrantyDuration || 12;
              const startDate = invoice.date;
              const startObj = new Date(startDate);
              startObj.setMonth(startObj.getMonth() + duration);
              const endDate = startObj.toISOString().split("T")[0];

              // Field names here must match models/ExtendedWarranty.ts exactly —
              // this used to write policyNumber/invoiceId/customerId/itemName/
              // provider, none of which exist on that schema (it wants
              // warrantyId/productName/vpCode instead), so every one of these
              // .create() calls failed validation and the invoice save silently
              // ended up warranty-less.
              const warrantyCount = await ExtendedWarranty.countDocuments();
              const warrantyId = `EW-2026-${String(warrantyCount + 1).padStart(4, "0")}-${Math.floor(1000 + Math.random() * 9000)}`;
              await ExtendedWarranty.create({
                warrantyId,
                invoiceNumber: invoice.invoiceNumber,
                customerName: invoice.customerName,
                customerPhone: invoice.customerPhone || "",
                itemId: item.itemId,
                productName: item.itemName,
                vpCode: item.vpCode || item.itemCode || "",
                serialNumber: item.serialNumber || "",
                planName: item.extendedWarrantyPlan,
                durationMonths: duration,
                startDate,
                endDate,
                warrantyAmount: item.extendedWarrantyAmount,
                salesStaff: invoice.salesExecutive || "Amit Singh",
                status: "Active",
                remarks: item.extendedWarrantyPolicyNo
                  ? `Provider policy #: ${item.extendedWarrantyPolicyNo}`
                  : "",
              });
            }
          }
        }
      }

      // 4.5 Auto-generate Delivery Challan if delayed delivery or vehicle number provided
      if (body.dispatchType === "delayed_delivery" || body.vehicleNumber || body.createChallan) {
        const DeliveryChallan = (await import("@/models/DeliveryChallan")).default;
        const count = await DeliveryChallan.countDocuments();
        const challanNo = `DC-2026-${String(count + 1).padStart(4, "0")}`;
        const firstItem = body.items?.[0];
        
        await DeliveryChallan.create({
          challanNo,
          type: "Outward Delivery",
          invoiceNumber: invoice.invoiceNumber,
          sourceParty: "M/S ASHOKA ENTERPRISES",
          sourceAddress: "H. NO. 116, NEAR SHANTI MARRIAGE HOUSE DEORIA ROAD, KUNRAGHAT GORAKHPUR",
          destinationParty: invoice.customerName,
          destinationAddress: body.shippingAddress || invoice.customerAddress || invoice.customerCity || "Gorakhpur",
          customerPhone: invoice.customerPhone || "",
          itemName: firstItem?.itemName || "Assorted Products",
          vpCode: firstItem?.vpCode || firstItem?.itemCode || "",
          hsn: firstItem?.hsnCode || firstItem?.hsn || "8528",
          serialImei: body.items?.map((it: any) => it.serialNumber).filter(Boolean).join(", ") || "",
          quantity: body.items?.reduce((sum: number, it: any) => sum + (it.quantity || 1), 0) || 1,
          unit: firstItem?.unit || "PCS",
          financeDoId: body.financeDoId || "",
          reason: body.dispatchType === "delayed_delivery" ? "Home Delivery Dispatch / Godown Delivery" : "Tax Invoice Dispatch",
          date: new Date(),
          vehicleNo: body.vehicleNumber || "",
          driverName: body.driverName || "Delivery Team",
          driverPhone: body.driverPhone || "",
          deliveryOtp: invoice.deliveryOtp || "",
          status: body.dispatchType === "delayed_delivery" ? "in-transit" : "delivered",
        });

        invoice.deliveryChallanNo = challanNo;
        await invoice.save();
      }

      // 4.6 Register Finance Transaction ONLY if Payment Mode is Finance
      //
      // A split bill settled partly through finance is saved with paymentMode
      // "Multiple", so it never matched the check below and its loan never reached
      // the payouts screen. Its finance row is the loan; the other rows are already
      // counted through `payments`, so no down payment is repeated on the DO.
      const financeSplitAmount = splitRows
        .filter((p: any) => classifyPaymentMode(p.mode) === "finance")
        .reduce((s: number, p: any) => s + p.amount, 0);
      if (body.paymentMode === "Finance" || financeSplitAmount > 0) {
        const FinanceTransaction = (await import("@/models/FinanceTransaction")).default;
        const doId = body.financeDoId || `DO-2026-${Math.floor(100000000 + Math.random() * 900000000)}`;

        const existingDO = await FinanceTransaction.findOne({ doId });
        if (!existingDO) {
          const grossLoan = financeSplitAmount > 0 ? financeSplitAmount : Number(body.financeGrossLoan || body.total || 0);
          const downPayment = financeSplitAmount > 0 ? 0 : Number(body.downPayment || body.financeDownPayment || 0);
          const subsidy = Number(body.financeDealerSubsidy || Math.round(grossLoan * 0.0354));
          const deductions = downPayment + subsidy + 270; // Matching typical DO calculations
          const netDisb = Math.max(0, grossLoan - deductions);

          await FinanceTransaction.create({
            financeProvider: body.financeProvider || "Bajaj Finance Limited",
            customerName: invoice.customerName,
            customerMobile: invoice.customerPhone || "N/A",
            deliveryAddress: invoice.customerAddress || "Gorakhpur, Uttar Pradesh",
            invoiceNumber: invoice.invoiceNumber,
            atosDealId: body.financeAppId || `CS${Date.now()}`,
            doId,
            date: invoice.date,
            assetCategory: body.items?.[0]?.category || "Electronics",
            oemCategory: body.items?.[0]?.itemName || "Electronics",
            manufacturer: body.items?.[0]?.brand || "Havells (Lloyd)",
            brand: body.items?.[0]?.brand || "Havells (Lloyd)",
            model: body.items?.[0]?.itemName || "",
            productModel: body.items?.[0]?.itemName || "",
            productPrice: invoice.total,
            grossLoanAmount: grossLoan,
            netLoanAmount: grossLoan,
            marginMoney: 0,
            advanceEmi: 0,
            dealerInterestSubsidy: subsidy,
            totalGst: 118,
            convenienceFee: 270,
            customerDownPayment: downPayment,
            totalDeductions: deductions,
            netDisbursement: netDisb,
            // The finance form is hidden while Split Payment is on, so whatever status
            // it last held is not something the cashier chose for this bill.
            approvalStatus: financeSplitAmount > 0 ? "Pending" : body.financeApprovalStatus || "Pending",
            uploadedPdfUrl: body.financePdfUrl || "",
          });
        }
      }

      // 5. Update Estimate Status & Auto-Attribute Sale to Salesperson
      if (body.linkedEstimateNumber) {
        const matchedEst = await Estimate.findOne({ estimateNumber: body.linkedEstimateNumber });
        if (matchedEst) {
          matchedEst.status = "Converted";
          matchedEst.convertedInvoiceNumber = invoice.invoiceNumber;
          await matchedEst.save();

          if ((!invoice.salesExecutive || invoice.salesExecutive === "Admin" || invoice.salesExecutive === "Store Staff") && (matchedEst.salesperson || matchedEst.salesExecutive)) {
            invoice.salesExecutive = matchedEst.salesperson || matchedEst.salesExecutive;
            invoice.createdBy = matchedEst.salesperson || matchedEst.salesExecutive;
            await invoice.save();
          }
        }
      } else {
        const phoneDigits = (invoice.customerPhone || "").replace(/\D/g, "");
        if (phoneDigits && phoneDigits.length >= 10) {
          const matchedEst = await Estimate.findOne({
            customerPhone: { $regex: phoneDigits.slice(-10) },
            status: { $ne: "Converted" }
          });
          if (matchedEst) {
            matchedEst.status = "Converted";
            matchedEst.convertedInvoiceNumber = invoice.invoiceNumber;
            await matchedEst.save();

            if ((!invoice.salesExecutive || invoice.salesExecutive === "Admin" || invoice.salesExecutive === "Store Staff") && (matchedEst.salesperson || matchedEst.salesExecutive)) {
              invoice.salesExecutive = matchedEst.salesperson || matchedEst.salesExecutive;
              invoice.createdBy = matchedEst.salesperson || matchedEst.salesExecutive;
              await invoice.save();
            }
          }
        }
      }

      // 6. Auto-Convert matching Walk-in/CRM Leads upon Customer Purchase
      // (an estimate is a quotation, not a purchase — it leaves the lead open)
      if (invoice.type !== "credit-note" && invoice.type !== "proforma") {
        try {
          const Lead = (await import("@/models/Lead")).default;
          const phoneDigits = (invoice.customerPhone || "").replace(/\D/g, "");
          const leadFilter: any = {
            status: { $in: ["New", "Contacted", "Interested", "Follow-up"] },
          };

          if (phoneDigits && phoneDigits.length >= 10) {
            leadFilter.mobile = { $regex: phoneDigits.slice(-10) };
          } else if (invoice.customerName && invoice.customerName !== "Cash Customer" && invoice.customerName !== "Cash Guest") {
            leadFilter.customerName = { $regex: new RegExp(`^${invoice.customerName.trim()}$`, "i") };
          }

          const matchedLeads = await Lead.find(leadFilter);
          // A bill saved without a real salesman on it is credited to whoever has
          // been working this customer's lead.
          const leadOwner = matchedLeads
            .map((l: any) => String(l.assignedStaff || "").trim())
            .find((name) => name && !/^sales team$/i.test(name));
          // The lead's salesperson gets the sale — unless the bill already names
          // another salesperson (they made the sale on the floor). A cashier,
          // admin or blank on the bill is replaced by the lead's owner.
          let billedBySalesperson = false;
          if (leadOwner && invoice.salesExecutive && invoice.salesExecutive.trim().toLowerCase() !== leadOwner.toLowerCase()) {
            const User = (await import("@/models/User")).default;
            const esc = invoice.salesExecutive.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const person: any = await User.findOne({ name: { $regex: new RegExp(`^${esc}$`, "i") } }, { role: 1 }).lean();
            billedBySalesperson = ["salesman", "sales"].includes(String(person?.role || "").toLowerCase());
          }
          if (leadOwner && !billedBySalesperson && invoice.salesExecutive !== leadOwner) {
            invoice.salesExecutive = leadOwner;
            await invoice.save();
          }
          for (const lead of matchedLeads) {
            lead.status = "Converted";
            lead.convertedInvoiceNumber = invoice.invoiceNumber;
            lead.timeline.push({
              date: new Date(),
              action: `Auto-Converted on Invoice #${invoice.invoiceNumber}`,
              notes: `Customer completed purchase of ₹${Number(invoice.total || invoice.netAmount || 0).toLocaleString("en-IN")}. Billed by ${invoice.salesExecutive || "Sales Team"}.`,
              staff: invoice.salesExecutive || "Sales Team",
            });
            await lead.save();
          }
        } catch (leadErr) {
          console.warn("Notice: Auto-lead conversion:", leadErr);
        }
      }

      // 7. Auto-Evaluate & Complete Sales Target Tasks for Sales Staff on Invoice Creation
      if (invoice.type !== "credit-note" && invoice.salesExecutive) {
        try {
          const StaffTask = (await import("@/models/StaffTask")).default;
          const salesPerson = invoice.salesExecutive.trim();
          const firstName = salesPerson.split(" ")[0];

          // Find active sales target tasks for this salesperson
          const activeTargetTasks = await StaffTask.find({
            status: { $in: ["Pending", "In Progress"] },
            taskType: "sales_target",
            $or: [
              { assignedStaff: { $regex: new RegExp(salesPerson, "i") } },
              { assignedStaff: { $regex: new RegExp(firstName, "i") } },
              { assignedStaff: "All Staff" },
              { assignedStaff: "Sales Staff" },
            ],
          });

          for (const task of activeTargetTasks) {
            let matchesTarget = false;
            let qtyIncrement = 0;
            const invoiceTotal = Number(invoice.total || invoice.netAmount || 0);

            // Check if task targets a specific product or brand
            if (task.targetProduct || task.targetBrand) {
              const targetP = (task.targetProduct || "").toLowerCase().trim();
              const targetB = (task.targetBrand || "").toLowerCase().trim();

              for (const lineItem of (invoice.items || [])) {
                const itemN = (lineItem.itemName || "").toLowerCase();
                const itemC = (lineItem.category || "").toLowerCase();
                const itemB = (lineItem.brand || "").toLowerCase();

                if ((targetP && (itemN.includes(targetP) || itemC.includes(targetP))) ||
                    (targetB && (itemB.includes(targetB) || itemN.includes(targetB)))) {
                  matchesTarget = true;
                  qtyIncrement += Number(lineItem.quantity || lineItem.qty || 1);
                }
              }
            } else {
              // General revenue/sales target
              matchesTarget = true;
              qtyIncrement = (invoice.items || []).reduce((acc: number, it: any) => acc + (Number(it.quantity || it.qty) || 1), 0);
            }

            if (matchesTarget) {
              task.currentQty = (Number(task.currentQty) || 0) + (qtyIncrement || 1);
              task.currentAmount = (Number(task.currentAmount) || 0) + invoiceTotal;
              task.status = "In Progress";
              task.linkedInvoiceNumber = invoice.invoiceNumber;

              const isQtyMet = task.targetQty ? task.currentQty >= task.targetQty : true;
              const isAmountMet = task.targetAmount ? task.currentAmount >= task.targetAmount : true;

              if (isQtyMet && isAmountMet) {
                task.status = "Completed";
                task.completedAt = new Date();
                task.completionRemarks = `Auto-completed upon generating Invoice #${invoice.invoiceNumber} (Total: ₹${invoiceTotal.toLocaleString("en-IN")})`;
              }
              await task.save();
            }
          }
        } catch (taskErr) {
          console.warn("Notice: Auto-task completion:", taskErr);
        }
      }

      // 7.9 Use money already received from this customer through Receive
      // Payment (a payment with no bill, which leaves their outstandingBalance
      // negative). Capped at the credit they really have and at the advance
      // deducted on this bill; the used part is taken off their credit.
      let creditUsed = 0;
      if (creditRequested > 0 && invoice.type === "tax-invoice" && mongoose.isValidObjectId(body.customerId)) {
        try {
          const Customer = (await import("@/models/Customer")).default;
          const customerDoc: any = await Customer.findById(body.customerId).select("outstandingBalance").lean();
          const availableCredit = Math.max(0, -(Number(customerDoc?.outstandingBalance) || 0));
          creditUsed = Math.round(Math.min(creditRequested, availableCredit, Number(body.advanceAdjusted) || 0) * 100) / 100;
          if (creditUsed > 0) {
            await Customer.findByIdAndUpdate(body.customerId, { $inc: { outstandingBalance: creditUsed } });
            invoice.creditAdjusted = creditUsed;
            await invoice.save();
          }
        } catch (creditErr) {
          console.warn("Notice: Customer credit adjustment:", creditErr);
        }
      }

      // 8. Adjust / Consume Customer Advance Booking Payment (Token Pre-booking)
      const advanceAdjustedVal = Number(body.advanceAdjusted || 0);
      // The part of the advance that came from Advance Booking receipts.
      const bookingAdjustedVal = Math.max(0, advanceAdjustedVal - creditUsed);
      if (advanceAdjustedVal > 0 && invoice.type !== "credit-note") {
        try {
          const CustomerAdvance = (await import("@/models/CustomerAdvance")).default;
          const Customer = (await import("@/models/Customer")).default;

          const phoneDigits = (invoice.customerPhone || "").replace(/\D/g, "");

          // 8.1 Deduct from Customer model
          if (phoneDigits && phoneDigits.length >= 10) {
            const customerObj = await Customer.findOne({ phone: phoneDigits });
            if (customerObj) {
              customerObj.advanceBalance = Math.max(0, (customerObj.advanceBalance || 0) - bookingAdjustedVal);
              await customerObj.save();
            }
          }

          // 8.2 Adjust against active CustomerAdvance receipts
          let remainingToDeduct = bookingAdjustedVal;
          const activeAdvances = await CustomerAdvance.find({
            customerPhone: phoneDigits,
            status: { $in: ["Available", "Partially Used"] },
          }).sort({ createdAt: 1 });

          for (const adv of activeAdvances) {
            if (remainingToDeduct <= 0) break;
            const deductibleFromThis = Math.min(adv.remainingBalance, remainingToDeduct);
            adv.usedAmount = (adv.usedAmount || 0) + deductibleFromThis;
            adv.remainingBalance = Math.max(0, adv.remainingBalance - deductibleFromThis);
            if (adv.remainingBalance === 0) {
              adv.status = "Fully Adjusted";
            } else {
              adv.status = "Partially Used";
            }
            adv.linkedInvoiceNumber = invoice.invoiceNumber;
            adv.notes = `${adv.notes ? adv.notes + " | " : ""}Adjusted ₹${deductibleFromThis} on Invoice #${invoice.invoiceNumber}`;
            await adv.save();
            remainingToDeduct -= deductibleFromThis;
          }

          invoice.advanceAdjusted = advanceAdjustedVal;
          invoice.advanceReceiptNo = body.advanceReceiptNo || (activeAdvances[0]?.receiptNumber || "");
          await invoice.save();
        } catch (advErr) {
          console.warn("Notice: Advance adjustment sync:", advErr);
        }
      }

      return NextResponse.json({
        success: true,
        data: invoice,
        ...(numberReassignedFrom
          ? {
              numberReassignedFrom,
              message: `Number ${numberReassignedFrom} was already in use; this bill was saved as ${invoice.invoiceNumber}.`,
            }
          : {}),
      });
    } catch (error: any) {
      // The invoice itself is already written and the customer has been billed.
      // Deleting it because a follow-up step failed (stock decrement, serial
      // allocation, estimate linking) threw the sale away entirely — the bill
      // vanished from the list and the dashboard with no trace. Keep the record and
      // report what didn't finish so it can be reconciled.
      console.error(`Post-save step failed for ${invoice.invoiceNumber}:`, error?.message);
      return NextResponse.json({
        success: true,
        data: invoice,
        warning: `Invoice saved, but a follow-up step did not complete: ${error?.message || "unknown error"}`,
        ...(numberReassignedFrom ? { numberReassignedFrom } : {}),
      });
    }
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 400 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json();
    await connectToDatabase();
    
    if (!body.invoiceNumber) {
      return NextResponse.json({ success: false, error: "Invoice number is required for update" }, { status: 400 });
    }

    const existingInvoice = await Invoice.findOne({ invoiceNumber: body.invoiceNumber });
    if (!existingInvoice) {
      return NextResponse.json({ success: false, error: "Invoice not found" }, { status: 404 });
    }

    // A bill already made as "Immediate Handover" whose goods are in fact handed
    // over later (e.g. kept till December). The sale, payment and stock stay as
    // they are — the goods are sold and off stock — only the delivery is now
    // pending, with the date it is due, so it shows in Order Dispatch and a
    // reminder goes out before that date.
    if (body.action === "mark-delivery-pending") {
      const actor = await getActor();
      if (!actor) {
        return NextResponse.json({ success: false, error: "You must be signed in to do this." }, { status: 401 });
      }
      if (!["admin", "superadmin", "manager", "accounts", "cashier"].includes(actor.role)) {
        return NextResponse.json({ success: false, error: "You are not allowed to change a bill's delivery." }, { status: 403 });
      }
      if (existingInvoice.status === "cancelled" || existingInvoice.type === "proforma" || existingInvoice.type === "credit-note") {
        return NextResponse.json({ success: false, error: "Only a live tax invoice can have a pending delivery." }, { status: 400 });
      }
      const due = String(body.expectedDeliveryDate || "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) {
        return NextResponse.json({ success: false, error: "Enter the expected delivery date." }, { status: 400 });
      }
      if (due < String(existingInvoice.date || "").slice(0, 10)) {
        return NextResponse.json({ success: false, error: "The delivery date cannot be before the bill date." }, { status: 400 });
      }
      const wasDelivered = existingInvoice.deliveryStatus === "delivered" || !existingInvoice.deliveryStatus;
      (existingInvoice as any).dispatchType = "delayed_delivery";
      if (wasDelivered) (existingInvoice as any).deliveryStatus = "pending_dispatch";
      if (!existingInvoice.deliveryOtp) {
        (existingInvoice as any).deliveryOtp = Math.floor(1000 + Math.random() * 9000).toString();
      }
      (existingInvoice as any).expectedDeliveryDate = due;
      (existingInvoice as any).deliveryNote = String(body.deliveryNote || "").trim();
      (existingInvoice as any).deliveryReminderSentAt = undefined;
      (existingInvoice as any).deliveredAt = undefined;
      const saved = await existingInvoice.save();
      try {
        await AuditLog.create({
          action: "invoice.delivery.pending",
          entityType: "Invoice",
          entityRef: existingInvoice.invoiceNumber,
          entityId: String(existingInvoice._id),
          partyName: existingInvoice.customerName,
          amount: Number(existingInvoice.total) || 0,
          reason: `Delivery pending till ${due}${body.deliveryNote ? " — " + String(body.deliveryNote).trim() : ""}`,
          performedBy: actor.name,
          performedByUserId: actor.id,
          performedByRole: actor.role,
        });
      } catch (logErr) {
        console.warn("Notice: audit log for delivery pending:", logErr);
      }
      return NextResponse.json({ success: true, message: `Delivery of ${existingInvoice.invoiceNumber} is pending till ${due}.`, data: saved });
    }

    // Special handler for clearing Due / Settlement from Dashboard
    if (body.action === "clear-due" || body.dueClearedMode) {
      // A credit note is money owed BACK to the customer, so it has no due to
      // collect. Running this flow on one recorded the refund as an inbound
      // receipt, which let the same amount reduce the customer's balance twice —
      // once as the credit note itself and once as the "receipt".
      if (existingInvoice.type === "credit-note") {
        return NextResponse.json(
          {
            success: false,
            error:
              "A credit note cannot be cleared as a due — it is money owed back to the customer. Record a refund payment against it instead.",
          },
          { status: 400 }
        );
      }

      // A financed bill's balance is owed by the finance company, not the customer.
      // "Clearing" it is the financier's payout reaching a store bank account, so it
      // is recorded as a finance disbursement rather than a khata receipt — which
      // used to count the loan a second time, as NEFT revenue on top of Finance.
      if (isFinanceInvoice(existingInvoice)) {
        if (!(Number(existingInvoice.balanceAmount) > 0)) {
          return NextResponse.json({ success: false, error: "This finance bill has no pending payout." }, { status: 400 });
        }
        if (!body.bankAccountId && !body.bankAccountRef) {
          return NextResponse.json(
            { success: false, error: "Select the bank account the finance payout was credited to." },
            { status: 400 }
          );
        }
        const { recordFinancePayout } = await import("@/lib/financeSettlement");
        const result = await recordFinancePayout({
          invoiceNumber: existingInvoice.invoiceNumber,
          amount: Number(body.clearedAmount) || undefined,
          bankAccountId: body.bankAccountId,
          bankAccountRef: body.bankAccountRef,
          utr: body.dueClearedTxnId,
          date: body.paymentReceivedDate,
          by: body.dueClearedBy,
          remarks: body.dueClearedNotes,
        });
        return NextResponse.json({
          success: true,
          financePayout: true,
          message: `Finance payout of ₹${result.amount.toLocaleString("en-IN")} recorded${result.bankAccountRef ? ` in ${result.bankAccountRef}` : ""}`,
          data: result.invoice,
        });
      }

      // Money that did not come in as cash landed in a bank account — remember which.
      const { resolveBankAccount, bankAccountLabel, creditBankAccount } = await import("@/lib/financeSettlement");
      const clearedIntoAccount = isCollectedMode(body.dueClearedMode) && classifyPaymentMode(body.dueClearedMode) !== "cash"
        ? await resolveBankAccount(body.bankAccountId, body.bankAccountRef)
        : null;
      const clearedBankAccountId = clearedIntoAccount ? String(clearedIntoAccount._id) : "";
      const clearedBankAccountRef = clearedIntoAccount ? bankAccountLabel(clearedIntoAccount) : "";

      // Clamped so a typo or stale client value can never collect more than
      // is actually outstanding, or go negative. Defaulting to the full
      // balance (when nothing was specified) keeps the old "clear it all"
      // behaviour for callers that don't pass a partial amount.
      const requestedAmount = Number(body.clearedAmount) || existingInvoice.balanceAmount;
      const amountToApply = Math.max(0, Math.min(requestedAmount, existingInvoice.balanceAmount));
      const isFullyCleared = amountToApply >= existingInvoice.balanceAmount;

      existingInvoice.paidAmount = (Number(existingInvoice.paidAmount) || 0) + amountToApply;
      existingInvoice.balanceAmount = Math.max(0, existingInvoice.total - existingInvoice.paidAmount);
      existingInvoice.status = existingInvoice.balanceAmount <= 0 ? "paid" : "partial";
      existingInvoice.dueClearedAt = new Date();
      existingInvoice.dueClearedMode = body.dueClearedMode || "Cash";
      existingInvoice.dueClearedBy = body.dueClearedBy || "Counter Staff";
      existingInvoice.dueClearedNotes =
        body.dueClearedNotes ||
        (isFullyCleared
          ? "Due fully settled and cleared"
          : `Partial due payment of ₹${amountToApply.toLocaleString("en-IN")} collected — ₹${existingInvoice.balanceAmount.toLocaleString("en-IN")} still outstanding`);
      existingInvoice.dueClearedTxnId = body.dueClearedTxnId || `CLR-${Date.now()}`;
      existingInvoice.dueClearedBankAccountId = clearedBankAccountId;
      existingInvoice.dueClearedBankAccount = clearedBankAccountRef;
      existingInvoice.lastModifiedReason = "due-clear";

      const saved = await existingInvoice.save();
      await creditBankAccount(clearedBankAccountId, amountToApply);

      // Deduct from customer's outstanding balance
      if (existingInvoice.customerId && amountToApply > 0) {
        await Customer.findByIdAndUpdate(existingInvoice.customerId, {
          $inc: { outstandingBalance: -amountToApply }
        });
      }

      // Record Payment Transaction
      try {
        const PaymentTransaction = (await import("@/models/PaymentTransaction")).default;
        await PaymentTransaction.create({
          transactionId: `TXN-DUE-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          partyId: existingInvoice.customerId,
          partyType: "Customer",
          partyName: existingInvoice.customerName,
          amount: amountToApply,
          paymentMode: body.dueClearedMode || "Cash",
          date: new Date().toISOString().split("T")[0],
          referenceId: existingInvoice.invoiceNumber,
          notes: `${isFullyCleared ? "Due balance cleared" : "Partial due payment collected"} for Invoice #${existingInvoice.invoiceNumber} via ${body.dueClearedMode || "Cash"}${clearedBankAccountRef ? ` into ${clearedBankAccountRef}` : ""}. Txn/Ref: ${body.dueClearedTxnId || "N/A"}`,
          type: "received",
          bankAccountId: clearedBankAccountId,
          bankAccountRef: clearedBankAccountRef,
          bankTxnRef: body.dueClearedTxnId || "",
        });
      } catch (txErr) {
        console.warn("Notice: PaymentTransaction log for due clearance:", txErr);
      }

      return NextResponse.json({
        success: true,
        message: isFullyCleared ? "Due settled and cleared successfully" : "Partial payment recorded successfully",
        data: saved,
      });
    }

    // Soft-cancel: unlike DELETE, the invoice record survives (for audit / leakage tracking)
    // Full edit from the billing form (products, prices, customer, payment):
    // PIN + reason, then stock, serials, balance and receipts are re-done.
    if (body.action === "full-edit") {
      const gate = await authoriseDestructiveAction(req, "invoice.edit", body.pin, body.reason);
      if (!gate.ok) return gate.response;
      const result = await fullEditInvoice(existingInvoice, body.invoice || {}, gate.actor, gate.reason, {
        ip: gate.ip,
        userAgent: gate.userAgent,
        usedLegacyPin: gate.usedLegacyPin,
      });
      if (!result.ok) return NextResponse.json({ success: false, error: result.error }, { status: result.status });
      return NextResponse.json({ success: true, message: "Invoice updated", data: result.invoice });
    }

    if (body.action === "cancel") {
      const gate = await authoriseDestructiveAction(
        req,
        "invoice.cancel",
        body.pin,
        body.reason
      );
      if (!gate.ok) return gate.response;

      if (existingInvoice.status === "cancelled") {
        return NextResponse.json({ success: false, error: "Invoice is already cancelled" }, { status: 400 });
      }

      // Reverse customer's outstanding balance (same logic as hard delete)
      if (existingInvoice.balanceAmount > 0 && existingInvoice.customerId && existingInvoice.type !== "proforma") {
        await Customer.findByIdAndUpdate(existingInvoice.customerId, {
          $inc: { outstandingBalance: existingInvoice.type === "credit-note" ? existingInvoice.balanceAmount : -existingInvoice.balanceAmount }
        });
      }

      // Reverse inventory stock (same logic as hard delete) — against the same
      // warehouse this sale actually deducted from, not whoever's cancelling it.
      if (existingInvoice.type !== "proforma" && existingInvoice.items && existingInvoice.items.length > 0) {
        const reversalWarehouseId = existingInvoice.warehouseId ? String(existingInvoice.warehouseId) : null;
        for (const item of existingInvoice.items) {
          if (item.itemId) {
            const delta = existingInvoice.type === "credit-note" ? -item.quantity : item.quantity;
            await applyStockMovement(item.itemId, reversalWarehouseId, delta);
          }
        }
      }

      existingInvoice.status = "cancelled";
      existingInvoice.cancelledAt = new Date().toISOString();
      existingInvoice.cancelledBy = gate.actor.name;
      existingInvoice.cancelReason = gate.reason;
      existingInvoice.lastModifiedReason = "cancel";

      const saved = await existingInvoice.save();

      // The audit row is best-effort: the cancel itself has already succeeded and
      // is recorded on the invoice, so a logging failure must not report it as an
      // error the user would then retry.
      try {
        await AuditLog.create({
          action: "invoice.cancel",
          entityType: "Invoice",
          entityRef: existingInvoice.invoiceNumber,
          entityId: String(existingInvoice._id),
          partyName: existingInvoice.customerName,
          amount: Number(existingInvoice.total) || 0,
          reason: gate.reason,
          performedBy: gate.actor.name,
          performedByUserId: gate.actor.id,
          performedByRole: gate.actor.role,
          pinVerified: true,
          usedLegacyPin: gate.usedLegacyPin,
          ip: gate.ip,
          userAgent: gate.userAgent,
          metadata: { paymentMode: existingInvoice.paymentMode, date: existingInvoice.date },
        });
      } catch (logErr) {
        console.warn("Notice: audit log for invoice cancel:", logErr);
      }

      return NextResponse.json({
        success: true,
        message: "Invoice cancelled successfully",
        usedLegacyPin: gate.usedLegacyPin,
        data: saved,
      });
    }

    if (body.customerGST) {
      body.customerPAN = body.customerPAN || derivePanFromGstin(body.customerGST);
      if (body.customerCompanyName) {
        try {
          const BillingCompany = (await import("@/models/BillingCompany")).default;
          await BillingCompany.findOneAndUpdate(
            { gstin: String(body.customerGST).trim().toUpperCase() },
            {
              $set: { companyName: body.customerCompanyName, pan: body.customerPAN },
              $inc: { usageCount: 1 },
            },
            { upsert: true, setDefaultsOnInsert: true }
          );
        } catch (companyErr: any) {
          console.error("BillingCompany upsert failed, saving invoice edit anyway:", companyErr?.message);
        }
      }
    }

    // Products already on the bill keep the cost they were first sold at.
    if (Array.isArray(body.items)) body.items = await stampLineCosts(body.items, existingInvoice.items as any[]);

    const updatedInvoice = await Invoice.findOneAndUpdate(
      { invoiceNumber: body.invoiceNumber },
      { ...body, lastModifiedReason: "content-edit" },
      { new: true }
    );

    return NextResponse.json({ success: true, message: "Invoice updated successfully", data: updatedInvoice });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const invoiceNumber = searchParams.get("invoiceNumber");

    if (!invoiceNumber) {
      return NextResponse.json({ success: false, error: "Invoice number is required" }, { status: 400 });
    }

    // A DELETE carries no body in some clients, so the PIN and reason may arrive
    // either way. Both are read before anything is changed.
    let payload: any = {};
    try {
      payload = await req.json();
    } catch {
      payload = {};
    }
    const pin = payload.pin ?? searchParams.get("pin") ?? "";
    const reason = payload.reason ?? searchParams.get("reason") ?? "";

    const gate = await authoriseDestructiveAction(req, "invoice.delete", pin, reason);
    if (!gate.ok) return gate.response;

    await connectToDatabase();

    const invoice = await Invoice.findOne({ invoiceNumber });
    if (!invoice) {
      return NextResponse.json({ success: false, error: "Invoice not found" }, { status: 404 });
    }

    const snapshot = invoice.toObject();

    // Archive BEFORE unwinding anything: if the archive write fails there is still
    // an invoice to look at, whereas a half-reversed bill with no record would be
    // unrecoverable.
    await DeletedInvoice.create({
      ...snapshot,
      _id: undefined,
      invoiceNumber: invoice.invoiceNumber,
      docType: invoice.type === "proforma" ? "Proforma" : invoice.type === "credit-note" ? "Credit Note" : invoice.type === "sales-order" ? "Sales Order" : "Invoice",
      customerName: invoice.customerName,
      total: Number(invoice.total) || 0,
      deletedAt: new Date(),
      deletedBy: gate.actor.name,
      deletedByRole: gate.actor.role,
      deletedByUserId: gate.actor.id,
      deleteReason: gate.reason,
      pinVerified: true,
      usedLegacyPin: gate.usedLegacyPin,
      snapshot,
    });

    // Reversal logic below is unchanged from before this route required a PIN.
    if (invoice.balanceAmount > 0 && invoice.type !== "proforma") {
      await Customer.findByIdAndUpdate(invoice.customerId, {
        $inc: { outstandingBalance: invoice.type === "credit-note" ? invoice.balanceAmount : -invoice.balanceAmount }
      });
    }

    // Give back the Receive Payment credit this bill used.
    if (Number(invoice.creditAdjusted) > 0) {
      await Customer.findByIdAndUpdate(invoice.customerId, {
        $inc: { outstandingBalance: -Number(invoice.creditAdjusted) }
      });
    }

    if (invoice.type !== "proforma") {
      if (invoice.items && invoice.items.length > 0) {
        const reversalWarehouseId = invoice.warehouseId ? String(invoice.warehouseId) : null;
        for (const item of invoice.items) {
          if (item.itemId) {
            const delta = invoice.type === "credit-note" ? -item.quantity : item.quantity;
            await applyStockMovement(item.itemId, reversalWarehouseId, delta);
          }
        }
      }
    }

    await Invoice.findOneAndDelete({ invoiceNumber });

    try {
      await AuditLog.create({
        action: "invoice.delete",
        entityType: "Invoice",
        entityRef: invoice.invoiceNumber,
        entityId: String(invoice._id),
        partyName: invoice.customerName,
        amount: Number(invoice.total) || 0,
        reason: gate.reason,
        performedBy: gate.actor.name,
        performedByUserId: gate.actor.id,
        performedByRole: gate.actor.role,
        pinVerified: true,
        usedLegacyPin: gate.usedLegacyPin,
        ip: gate.ip,
        userAgent: gate.userAgent,
        metadata: { paymentMode: invoice.paymentMode, date: invoice.date, type: invoice.type },
      });
    } catch (logErr) {
      console.warn("Notice: audit log for invoice delete:", logErr);
    }

    return NextResponse.json({
      success: true,
      message: "Invoice deleted and archived to the audit trail",
      usedLegacyPin: gate.usedLegacyPin,
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
