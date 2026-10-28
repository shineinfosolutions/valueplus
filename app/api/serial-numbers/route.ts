import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import SerialNumber from "@/models/SerialNumber";
import PurchaseEntry from "@/models/PurchaseEntry";
import Invoice from "@/models/Invoice";
import Item from "@/models/Item";

const RECONCILE_EVERY_MS = 5 * 60 * 1000;
let lastReconcileAt = 0;

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const vpCode = searchParams.get("vpCode");
    const itemId = searchParams.get("itemId");
    const itemName = searchParams.get("name");
    const status = searchParams.get("status") || "AVAILABLE";
    
    await connectToDatabase();
    
    // Bills and purchase entries already keep each serial's status up to date;
    // this full re-check is a safety net, so it runs at most every few minutes
    // instead of on every request (it took ~10s and held up the billing form).
    const soldSerialsSet = new Set<string>();
    if (Date.now() - lastReconcileAt > RECONCILE_EVERY_MS) {
      lastReconcileAt = Date.now();
      // 1. Reconcile / Sync serial numbers from existing Purchase Entries into SerialNumber collection
      const purchaseEntries = await PurchaseEntry.find({}).lean();
      const items = await Item.find({}).lean();
      const itemMap = new Map();
      items.forEach((it: any) => {
        itemMap.set(it._id.toString(), it);
        if (it.code) itemMap.set(it.code.toLowerCase(), it);
        if (it.name) itemMap.set(it.name.toLowerCase().trim(), it);
      });

      // Collected and written in one bulk call: one database round trip per serial
      // made this list take many seconds to load, and on a phone the billing form's
      // serial dropdown stayed empty until it did.
      const inwardOps: any[] = [];
      for (const pe of purchaseEntries) {
        if (Array.isArray(pe.items)) {
          for (const line of pe.items) {
            if (Array.isArray(line.serialNumbers) && line.serialNumbers.length > 0) {
              const matchedItem = (line.itemId && itemMap.get(line.itemId.toString())) ||
                                  (line.name && itemMap.get(line.name.toLowerCase().trim())) ||
                                  null;
              const itId = matchedItem?._id ? matchedItem._id.toString() : (line.itemId || "");
              const vp = matchedItem?.vpCode || matchedItem?.code || "VP-GEN";
              const itName = matchedItem?.name || line.name || "";

              for (const sn of line.serialNumbers) {
                const cleanSn = String(sn || "").trim();
                if (cleanSn) {
                  inwardOps.push({ updateOne: {
                    filter: { serialNumber: cleanSn },
                    update: {
                      $setOnInsert: {
                        serialNumber: cleanSn,
                        itemId: itId,
                        vpCode: vp,
                        itemName: itName,
                        status: pe.type === "debit-note" ? "RETURNED" : "AVAILABLE",
                        purchaseEntryId: pe._id.toString(),
                        price: line.rate || 0,
                        warehouse: matchedItem?.warehouse || "Main Store - Gorakhpur",
                        history: [{
                          action: `Inward via Bill #${pe.billNo}`,
                          date: new Date(pe.billDate || pe.createdAt || Date.now()),
                          performedBy: "Purchase Inward",
                          details: `Supplier: ${pe.supplierName}`,
                        }]
                      }
                    },
                    upsert: true,
                  } });
                }
              }
            }
          }
        }
      }
      if (inwardOps.length) await SerialNumber.bulkWrite(inwardOps);

      // 2. Mark any serial numbers that have already been billed in active Invoices as SOLD
      // A serial number written on an estimate has not been sold.
      const activeInvoices = await Invoice.find({ status: { $ne: "cancelled" }, type: { $ne: "proforma" } }).lean();
      const soldOps: any[] = [];
      for (const inv of activeInvoices) {
        if (Array.isArray(inv.items)) {
          for (const line of inv.items) {
            if (line.serialNumber && String(line.serialNumber).trim()) {
              const sn = String(line.serialNumber).trim();
              soldSerialsSet.add(sn);
              soldOps.push({ updateOne: {
                filter: { serialNumber: sn },
                update: {
                  $set: {
                    status: "SOLD",
                    invoiceId: inv._id.toString(),
                    invoiceNumber: inv.invoiceNumber,
                    customerName: inv.customerName,
                    customerPhone: inv.customerPhone || "",
                    soldDate: inv.date,
                  }
                },
              } });
            }
          }
        }
      }
      if (soldOps.length) await SerialNumber.bulkWrite(soldOps);
    }

    // 3. Build Query Filter
    const filter: any = {};
    if (status && status !== "ALL") {
      filter.status = status;
    }
    if (vpCode) filter.vpCode = vpCode;
    if (itemId) filter.itemId = itemId;
    if (itemName) {
      filter.itemName = { $regex: new RegExp(itemName.trim(), "i") };
    }
    
    const serials = await SerialNumber.find(filter).sort({ createdAt: -1 }).lean();

    // Final safety filter: ensure sold serials never leak into AVAILABLE response
    const result = status === "AVAILABLE" 
      ? serials.filter(s => !soldSerialsSet.has(s.serialNumber) && s.status === "AVAILABLE")
      : serials;

    return NextResponse.json({ success: true, data: result });
  } catch (error: any) {
    console.error("Error fetching serial numbers:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    await connectToDatabase();
    
    if (Array.isArray(body)) {
      const created = await SerialNumber.insertMany(body);
      return NextResponse.json({ success: true, data: created, message: `${created.length} serials registered` });
    }
    
    const serial = await SerialNumber.create(body);
    return NextResponse.json({ success: true, data: serial });
  } catch (error: any) {
    if (error.code === 11000) {
      return NextResponse.json({ success: false, error: "Serial number already exists in the system" }, { status: 400 });
    }
    return NextResponse.json({ success: false, error: error.message }, { status: 400 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json();
    await connectToDatabase();
    
    const { serialNumber, status, invoiceNumber, customerName, customerPhone, notes } = body;
    if (!serialNumber) {
      return NextResponse.json({ success: false, error: "Serial number is required" }, { status: 400 });
    }
    
    const updateData: any = {};
    if (status) updateData.status = status;
    if (invoiceNumber) updateData.invoiceNumber = invoiceNumber;
    if (customerName) updateData.customerName = customerName;
    if (customerPhone) updateData.customerPhone = customerPhone;
    if (status === "SOLD") updateData.soldDate = new Date().toISOString().split("T")[0];
    
    updateData.$push = {
      history: {
        action: status ? `Status changed to ${status}` : "Updated details",
        date: new Date(),
        performedBy: body.performedBy || "Staff",
        details: notes || `Updated via system`,
      },
    };
    
    const updated = await SerialNumber.findOneAndUpdate({ serialNumber }, updateData, { new: true });
    if (!updated) {
      return NextResponse.json({ success: false, error: "Serial number not found" }, { status: 404 });
    }
    
    return NextResponse.json({ success: true, data: updated });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const serialNumber = searchParams.get("serialNumber");
    const id = searchParams.get("id");

    await connectToDatabase();

    if (id) {
      await SerialNumber.findByIdAndDelete(id);
      return NextResponse.json({ success: true, message: "Serial number deleted" });
    }

    if (serialNumber) {
      await SerialNumber.findOneAndDelete({ serialNumber });
      return NextResponse.json({ success: true, message: "Serial number deleted" });
    }

    return NextResponse.json({ success: false, error: "Serial number or ID is required" }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
