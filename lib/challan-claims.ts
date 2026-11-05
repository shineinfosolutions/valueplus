import mongoose from "mongoose";
import DeliveryChallan from "@/models/DeliveryChallan";
import Item from "@/models/Item";
import Warehouse from "@/models/Warehouse";
import Supplier from "@/models/Supplier";
import SerialNumber from "@/models/SerialNumber";
import PurchaseEntry from "@/models/PurchaseEntry";
import { applyStockMovement } from "@/lib/stock";
import { todayInIndia } from "@/lib/today";

/**
 * Defective-return claims on delivery challans.
 *
 * SUPPLIER RETURN — a product we bought turned out defective and goes back to the supplier.
 *   on the challan:  the unit leaves our stock, its serial becomes RETURNED. The claim is "pending".
 *   settle CR:       the supplier gave money. A debit note is raised in the supplier's name for that amount; it
 *                    sits in his ledger as credit (lowers what we owe), so it comes off the next purchase bill.
 *   settle PR:       the supplier sent a replacement product. It comes into stock with its own serial.
 *
 * CUSTOMER RETURN — a customer got a defective product and brings it back.
 *   on the challan:  the unit comes back into our stock with its serial marked DEFECTIVE (it is then sent on to the
 *                    supplier with a Supplier Return challan). The claim is "pending".
 *   settle PR:       the customer is given a replacement: it goes out of stock and its serial is SOLD to him.
 *
 * Cancelling a pending claim puts stock and serials back as they were.
 */

export const CLAIM_TYPES = ["Supplier Return", "Customer Return"];
export const isClaimType = (type: any) => CLAIM_TYPES.includes(String(type || ""));
/** Who may settle or cancel a claim (a CR raises a debit note in the supplier ledger). */
export const CLAIM_SETTLER_ROLES = ["admin", "superadmin", "manager", "warehouse", "accounts"];

export const serialsOf = (s: any): string[] =>
  String(s || "")
    .split(/[,\n]+/)
    .map((x) => x.trim().toUpperCase())
    .filter(Boolean);

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const r2 = (n: number) => Math.round(n * 100) / 100;

export class ClaimError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/** The catalog product a challan line is for: by id, then VP code / code, then exact name. */
export async function findProduct(ref: { itemId?: any; vpCode?: any; itemName?: any }): Promise<any | null> {
  if (ref.itemId && mongoose.isValidObjectId(ref.itemId)) {
    const byId = await Item.findById(ref.itemId).lean();
    if (byId) return byId;
  }
  const code = String(ref.vpCode || "").trim();
  if (code) {
    if (mongoose.isValidObjectId(code)) {
      const byIdCode = await Item.findById(code).lean();
      if (byIdCode) return byIdCode;
    }
    const byCode = await Item.findOne({ $or: [{ vpCode: code }, { code }] }).lean();
    if (byCode) return byCode;
  }
  const name = String(ref.itemName || "").trim();
  if (name) return Item.findOne({ name: { $regex: new RegExp(`^${esc(name)}$`, "i") } }).lean();
  return null;
}

/** The warehouse stock moves in: the one named on the challan, else where the product has the most stock. */
async function warehouseFor(name: any, product: any): Promise<{ id: string | null; name: string }> {
  const wanted = String(name || "").trim();
  if (wanted) {
    const w: any = mongoose.isValidObjectId(wanted)
      ? await Warehouse.findById(wanted).lean()
      : await Warehouse.findOne({ name: { $regex: new RegExp(`^${esc(wanted)}$`, "i") } }).lean();
    if (w) return { id: String(w._id), name: w.name };
  }
  const entries: any[] = product?.stockByWarehouse || [];
  const best = [...entries].sort((a, b) => (Number(b.qty) || 0) - (Number(a.qty) || 0))[0];
  if (best?.warehouseId) {
    const w: any = await Warehouse.findById(best.warehouseId).lean();
    if (w) return { id: String(w._id), name: w.name };
  }
  return { id: null, name: wanted || product?.warehouse || "" };
}

async function markSerials(
  serials: string[],
  set: Record<string, any>,
  action: string,
  details: string,
  by: string,
  product?: any
) {
  for (const sn of serials) {
    const exists = await SerialNumber.findOne({ serialNumber: sn }, { _id: 1 }).lean();
    if (!exists && !product) continue;
    await SerialNumber.findOneAndUpdate(
      { serialNumber: sn },
      {
        $set: set,
        ...(exists
          ? {}
          : {
              // Only the fields $set does not already write (the same path in both is a Mongo error).
              $setOnInsert: Object.fromEntries(
                Object.entries({
                  itemId: String(product._id),
                  vpCode: product.vpCode || product.code || "VP-GEN",
                  itemName: product.name,
                }).filter(([k]) => !(k in set))
              ),
            }),
        $push: { history: { action, date: new Date(), performedBy: by, details } },
      },
      { upsert: !exists, new: true }
    );
  }
}

async function nextDebitNoteNo(): Promise<string> {
  const year = new Date().getFullYear();
  let n = (await PurchaseEntry.countDocuments({ type: "debit-note" })) + 1;
  for (;;) {
    const billNo = `DN-${year}-${String(n).padStart(4, "0")}`;
    const clash = await PurchaseEntry.findOne({ billNo, type: "debit-note" }, { _id: 1 }).lean();
    if (!clash) return billNo;
    n++;
  }
}

async function findSupplier(id: any, name: any): Promise<any | null> {
  if (id && mongoose.isValidObjectId(id)) {
    const s = await Supplier.findById(id).lean();
    if (s) return s;
  }
  const n = String(name || "").trim();
  return n ? Supplier.findOne({ name: { $regex: new RegExp(`^${esc(n)}$`, "i") } }).lean() : null;
}

/**
 * Stock and serial effects of issuing a Supplier / Customer Return challan. Fills in itemId, warehouse and
 * supplierId on the payload, and marks the claim pending.
 */
export async function openClaim(payload: any, by: string): Promise<void> {
  const qty = Math.max(1, Number(payload.quantity) || 1);
  const product = await findProduct(payload);
  if (!product) throw new ClaimError(`"${payload.itemName}" is not in the product list. Pick the product from the list.`);
  const wh = await warehouseFor(payload.warehouse, product);
  const serials = serialsOf(payload.serialImei);

  payload.itemId = String(product._id);
  payload.warehouse = wh.name;
  payload.claimStatus = "pending";
  payload.flowType = "";
  payload.serialImei = serials.join(", ");

  if (payload.type === "Supplier Return") {
    const supplier = await findSupplier(payload.supplierId, payload.destinationParty);
    if (supplier) payload.supplierId = String(supplier._id);
    await applyStockMovement(String(product._id), wh.id, -qty);
    await markSerials(
      serials,
      { status: "RETURNED" },
      `Sent to supplier on challan #${payload.challanNo}`,
      `${payload.destinationParty || "Supplier"}${payload.defectDescription ? ` · Fault: ${payload.defectDescription}` : ""}`,
      by,
      product
    );
  } else {
    // Customer Return: the defective unit is back with us.
    await applyStockMovement(String(product._id), wh.id, qty);
    await markSerials(
      serials,
      { status: "DEFECTIVE", warehouse: wh.name },
      `Returned defective by customer on challan #${payload.challanNo}`,
      `${payload.sourceParty || "Customer"}${payload.defectDescription ? ` · Fault: ${payload.defectDescription}` : ""}`,
      by,
      product
    );
  }
}

export interface SettleInput {
  mode: "CR" | "PR";
  /** CR: the amount the supplier credited. */
  creditAmount?: number;
  /** PR: the replacement product (defaults to the same product) and its serial(s). */
  replacementItemId?: string;
  replacementSerial?: string;
  note?: string;
}

/** Settle a pending claim as CR or PR. Returns the updated challan and, for CR, the debit note number. */
export async function settleClaim(challanId: any, input: SettleInput, by: string) {
  const challan: any = await DeliveryChallan.findOne(
    mongoose.isValidObjectId(challanId) ? { _id: challanId } : { challanNo: String(challanId || "") }
  );
  if (!challan) throw new ClaimError("Challan not found.", 404);
  if (!isClaimType(challan.type)) throw new ClaimError("Only a Supplier Return or Customer Return challan is settled as CR / PR.");
  if (challan.claimStatus && challan.claimStatus !== "pending") throw new ClaimError(`This claim is already ${challan.claimStatus}.`, 409);
  if (!challan.claimStatus) {
    // A challan issued before claims were tracked: settled already under the old approval, or its stock and serials
    // were never moved — do that now, so the settlement below starts from the same place as a new challan.
    if (challan.approvalStatus === "approved") throw new ClaimError("This challan was already settled earlier.", 409);
    const opened: any = challan.toObject();
    await openClaim(opened, by);
    challan.itemId = opened.itemId;
    challan.warehouse = opened.warehouse;
    challan.supplierId = opened.supplierId || "";
    challan.serialImei = opened.serialImei;
    challan.claimStatus = "pending";
  }

  const qty = Math.max(1, Number(challan.quantity) || 1);
  const product = await findProduct(challan);
  const note = String(input.note || "").trim().slice(0, 300);

  if (input.mode === "CR") {
    if (challan.type !== "Supplier Return") {
      throw new ClaimError("A customer's defective product is settled by giving a replacement (PR).");
    }
    const amount = r2(Number(input.creditAmount) || 0);
    if (!(amount > 0)) throw new ClaimError("Enter the amount the supplier credited.");
    const supplier = await findSupplier(challan.supplierId, challan.destinationParty);
    const billNo = await nextDebitNoteNo();
    const today = todayInIndia();
    const wh = await warehouseFor(challan.warehouse, product);
    await PurchaseEntry.create({
      billNo,
      type: "debit-note",
      supplierName: supplier?.name || challan.destinationParty,
      supplierGST: supplier?.gstNumber || "",
      ...(supplier ? { supplierId: supplier._id } : {}),
      warehouse: wh.name || undefined,
      ...(wh.id ? { warehouseId: wh.id } : {}),
      billingEntity: product?.billingEntity === "ashoka" ? "ashoka" : "valueplus",
      billDate: today,
      dueDate: today,
      noPoReason: `Defective return credit (CR) on challan #${challan.challanNo}`,
      items: [
        {
          itemId: product ? String(product._id) : challan.itemId || "",
          name: challan.itemName,
          quantity: qty,
          rate: r2(amount / qty),
          gstRate: 0,
          hsn: challan.hsn || "",
          serialNumbers: serialsOf(challan.serialImei),
        },
      ],
      subtotal: amount,
      gst: 0,
      total: amount,
      paid: 0,
      balance: amount,
      status: "pending",
    });
    // The supplier's running balance: a debit note lowers what we owe him (same as a debit note made by hand).
    if (supplier) await Supplier.updateOne({ _id: supplier._id }, { $inc: { outstandingBalance: -amount } });

    challan.flowType = "CR";
    challan.creditAmount = amount;
    challan.debitNoteRef = billNo;
  } else {
    const replacement = input.replacementItemId ? await findProduct({ itemId: input.replacementItemId }) : product;
    if (!replacement) throw new ClaimError("Choose the replacement product.");
    const newSerials = serialsOf(input.replacementSerial);
    const wh = await warehouseFor(challan.warehouse, replacement);

    if (challan.type === "Supplier Return") {
      // The replacement comes in from the supplier.
      await applyStockMovement(String(replacement._id), wh.id, qty);
      await markSerials(
        newSerials,
        { status: "AVAILABLE", warehouse: wh.name, itemId: String(replacement._id), itemName: replacement.name },
        `Replacement from supplier (PR) on challan #${challan.challanNo}`,
        `${challan.destinationParty || "Supplier"} · replaces ${challan.serialImei || challan.itemName}`,
        by,
        replacement
      );
    } else {
      // The customer takes a replacement out of stock.
      await applyStockMovement(String(replacement._id), wh.id, -qty);
      await markSerials(
        newSerials,
        {
          status: "SOLD",
          customerName: challan.sourceParty || "",
          customerPhone: challan.sourcePhone || challan.customerPhone || "",
          ...(challan.invoiceNumber ? { invoiceNumber: challan.invoiceNumber } : {}),
          soldDate: todayInIndia(),
          itemId: String(replacement._id),
          itemName: replacement.name,
        },
        `Given to customer as replacement (PR) on challan #${challan.challanNo}`,
        `${challan.sourceParty || "Customer"} · replaces ${challan.serialImei || challan.itemName}`,
        by,
        replacement
      );
    }
    challan.flowType = "PR";
    challan.replacementItemId = String(replacement._id);
    challan.replacementItemName = replacement.name;
    challan.replacementSerial = newSerials.join(", ");
  }

  challan.claimStatus = "settled";
  challan.settledAt = new Date();
  challan.settledBy = by;
  challan.settlementNote = note;
  // Kept in step for older screens that read the approval fields.
  challan.approvalStatus = "approved";
  challan.approvedAt = challan.settledAt;
  challan.approvedBy = by;
  challan.status = challan.type === "Supplier Return" ? "received" : "delivered";
  await challan.save();
  return challan;
}

/** Cancel a pending claim: stock and serials go back to how they were before the challan. */
export async function cancelClaim(challanId: any, by: string, note?: string) {
  const challan: any = await DeliveryChallan.findOne(
    mongoose.isValidObjectId(challanId) ? { _id: challanId } : { challanNo: String(challanId || "") }
  );
  if (!challan) throw new ClaimError("Challan not found.", 404);
  if (!isClaimType(challan.type) || challan.claimStatus !== "pending") {
    throw new ClaimError("Only a pending return claim can be cancelled.");
  }
  const qty = Math.max(1, Number(challan.quantity) || 1);
  const product = await findProduct(challan);
  const wh = await warehouseFor(challan.warehouse, product);
  const serials = serialsOf(challan.serialImei);
  if (product) {
    await applyStockMovement(String(product._id), wh.id, challan.type === "Supplier Return" ? qty : -qty);
  }
  await markSerials(
    serials,
    { status: challan.type === "Supplier Return" ? "AVAILABLE" : "SOLD" },
    `Return challan #${challan.challanNo} cancelled`,
    String(note || ""),
    by
  );
  challan.claimStatus = "cancelled";
  challan.approvalStatus = "rejected";
  challan.settlementNote = String(note || "").trim().slice(0, 300);
  challan.settledBy = by;
  challan.settledAt = new Date();
  await challan.save();
  return challan;
}
