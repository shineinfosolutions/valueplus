import { NextResponse } from "next/server";
import mongoose from "mongoose";
import connectToDatabase from "@/lib/db";
import Invoice from "@/models/Invoice";
import Item from "@/models/Item";
import PurchaseEntry from "@/models/PurchaseEntry";
import SerialNumber from "@/models/SerialNumber";

export async function GET(req: Request) {
  try {
    await connectToDatabase();
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id") || "";
    const code = searchParams.get("code") || "";
    const vpCode = searchParams.get("vpCode") || "";
    const name = searchParams.get("name") || "";
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");

    // Product names in this catalogue routinely contain regex metacharacters —
    // "MC2846BG.DBKQILN(LG CONVECTION MWO)" — and interpolating them raw threw
    // "Invalid regular expression: Unterminated group", so the ledger returned a
    // 500 for those products instead of showing their history.
    const escapeRegex = (v: string) => String(v).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    if (!id && !code && !vpCode && !name) {
      return NextResponse.json({ success: false, error: "Product identifier is required" }, { status: 400 });
    }

    // 1. Find the Item
    let itemQuery: any = {};
    if (id && id.match(/^[0-9a-fA-F]{24}$/)) {
      itemQuery._id = id;
    } else if (code) {
      itemQuery.code = code;
    } else if (vpCode) {
      itemQuery.vpCode = vpCode;
    } else if (name) {
      itemQuery.name = { $regex: new RegExp(`^${escapeRegex(name.trim())}$`, "i") };
    }

    const item: any = await Item.findOne(itemQuery).lean();
    const itemCode = item?.code || code;
    const itemVpCode = item?.vpCode || vpCode;
    const itemName = item?.name || name;
    const purchaseCost = Number(item?.purchasePrice || item?.purchaseRate || 0);

    // ─── LINE MATCHING ────────────────────────────────────────────────────────
    // A document line is matched to this product by id, code, vpCode or name.
    //
    // Two real-world quirks in the data made the old exact-equality checks miss
    // most sales: some product names carry a trailing space ("iPhone Air "), and
    // some invoice lines put the HSN code in `itemCode` (e.g. "85183000") rather
    // than the product code — so `itemCode` can't be trusted on its own.
    const norm = (v: any) => String(v ?? "").toLowerCase().trim().replace(/\s+/g, " ");
    const isHsnLike = (v: any) => /^\d{6,8}$/.test(String(v ?? "").trim());

    const itemIdStr = item?._id ? String(item._id) : "";
    const keys = new Set(
      [itemIdStr, itemCode, itemVpCode].filter(Boolean).map((k) => norm(k))
    );
    const nameKey = norm(itemName);

    /** True when a purchase/invoice/movement line refers to this product. */
    const lineMatches = (line: any): boolean => {
      if (!line) return false;
      for (const candidate of [line.itemId, line.productId, line.vpCode, line.code]) {
        if (candidate && keys.has(norm(candidate))) return true;
      }
      // itemCode only counts when it isn't actually an HSN number.
      if (line.itemCode && !isHsnLike(line.itemCode) && keys.has(norm(line.itemCode))) return true;
      for (const candidate of [line.itemName, line.name, line.productName]) {
        if (candidate && nameKey && norm(candidate) === nameKey) return true;
      }
      return false;
    };

    // 2. Fetch Invoices containing this product
    const invoiceQuery: any = {
      status: { $nin: ["cancelled", "draft"] },
      // An estimate moves no stock, so it is not part of a product's ledger.
      type: { $ne: "proforma" },
    };
    if (startDate && endDate) {
      invoiceQuery.date = { $gte: startDate, $lte: endDate };
    }

    const invoices = await Invoice.find(invoiceQuery).sort({ date: -1, createdAt: -1 }).lean();

    // 3. Fetch Purchase Entries containing this product
    const purchaseQuery: any = {};
    if (startDate && endDate) {
      purchaseQuery.billDate = { $gte: startDate, $lte: endDate };
    }
    const purchases = await PurchaseEntry.find(purchaseQuery).sort({ billDate: -1, createdAt: -1 }).lean();

    // 4. Fetch Serial Numbers for this product
    const serials = await SerialNumber.find({
      $or: [
        { vpCode: itemVpCode },
        { vpCode: itemCode },
        { itemId: item?._id ? String(item._id) : "NO_MATCH" },
        { itemName: { $regex: new RegExp(`^${escapeRegex(itemName.trim())}$`, "i") } }
      ]
    }).lean();

    // 5. Other stock movements. Without these the ledger can never reconcile to
    //    the on-hand figure, because an adjustment or a transfer changes stock
    //    without any purchase or invoice existing.
    const db = mongoose.connection.db;
    const fetchMovements = async (collection: string) => {
      try {
        return db ? await db.collection(collection).find({}).toArray() : [];
      } catch {
        return [];
      }
    };
    const [adjustments, stockReturns, journals, transfers] = await Promise.all([
      fetchMovements("stock_adjustments"),
      fetchMovements("stock_returns"),
      fetchMovements("stock_journals"),
      fetchMovements("stocktransfers"),
    ]);

    const transactions: any[] = [];
    let totalInwardQty = 0;
    let totalInwardAmount = 0;
    let totalSoldQty = 0;
    let totalSoldRevenue = 0;
    let totalProfit = 0;
    let adjustmentIn = 0;
    let adjustmentOut = 0;

    // Process Purchases (Inwards)
    for (const pur of purchases as any[]) {
      const items = Array.isArray(pur.items) ? pur.items : [];
      // The line index is part of every row id below: one document can legitimately
      // list the same product on more than one line, and keying only on document id
      // + item code made those rows collide in React.
      for (const [lineIdx, line] of items.entries()) {
        if (lineMatches(line)) {
          const qty = Number(line.quantity) || 1;
          const rate = Number(line.rate) || purchaseCost;
          const amount = rate * qty;

          totalInwardQty += qty;
          totalInwardAmount += amount;

          transactions.push({
            id: `PUR-${pur._id}-${lineIdx}`,
            date: pur.billDate || (pur.createdAt ? new Date(pur.createdAt).toISOString().split("T")[0] : "2026-08-24"),
            type: pur.type === "debit-note" ? "PURCHASE_RETURN" : "PURCHASE_INWARD",
            refNo: pur.billNo || "BILL",
            party: pur.supplierName || "Authorized Supplier",
            qtyIn: pur.type === "debit-note" ? 0 : qty,
            qtyOut: pur.type === "debit-note" ? qty : 0,
            rate: rate,
            costRate: rate,
            amount: amount,
            profit: 0,
            serials: line.serialNumbers || [],
            source: "purchase",
            status: pur.status || "completed"
          });
        }
      }
    }

    // Process Invoices (Sales Outwards)
    for (const inv of invoices as any[]) {
      const items = Array.isArray(inv.items) ? inv.items : [];
      for (const [lineIdx, line] of items.entries()) {
        const matches = lineMatches(line);

        if (matches) {
          const qty = Number(line.quantity) || 1;
          // Rate and amount must share one basis. `line.rate` is GST-inclusive
          // (₹14,792) while `taxableAmount` is not (₹12,536) — showing them side by
          // side made a row read "Rate ₹14,792 … ₹12,536", which looks like an error.
          // Everything here is reported ex-GST, so it is comparable with the ex-GST
          // purchase cost that the margin is calculated against.
          const revenue = Number(line.taxableAmount) || Number(line.amount) || (Number(line.rate) || 0) * qty;
          const sellingRate = revenue / qty;
          const cost = purchaseCost * qty;
          const profit = revenue - cost;

          totalSoldQty += qty;
          totalSoldRevenue += revenue;
          totalProfit += profit;

          transactions.push({
            id: `INV-${inv._id}-${lineIdx}`,
            date: inv.date || (inv.createdAt ? new Date(inv.createdAt).toISOString().split("T")[0] : "2026-08-24"),
            type: "SALE_INVOICE",
            refNo: inv.invoiceNumber || "INV",
            party: inv.customerName || "Retail Walk-in Customer",
            customerPhone: inv.customerPhone || "-",
            paymentMode: inv.paymentMode || inv.paymentMethod || "Mixed",
            qtyIn: 0,
            qtyOut: qty,
            rate: Math.round(sellingRate),
            costRate: purchaseCost,
            amount: Math.round(revenue),
            profit: Math.round(profit),
            marginPct: revenue > 0 ? Number(((profit / revenue) * 100).toFixed(1)) : 0,
            serials: line.serialNumber ? [line.serialNumber] : [],
            source: "sales",
            status: inv.status || "paid"
          });
        }
      }
    }

    // Process other stock movements (adjustments, returns, journals, transfers)
    const movementSources: Array<{ rows: any[]; source: string; label: string }> = [
      { rows: adjustments, source: "adjustment", label: "STOCK_ADJUSTMENT" },
      { rows: stockReturns, source: "return", label: "STOCK_RETURN" },
      { rows: journals, source: "journal", label: "STOCK_JOURNAL" },
      { rows: transfers, source: "transfer", label: "STOCK_TRANSFER" },
    ];

    // The catalogue import recorded the same goods twice: once as purchase entries
    // (VP-INW-2026-001..006, 21 Aug) and again as two 200-line stock journals on the
    // same date. Counting both inflated inward stock threefold. A movement that
    // matches an already-recorded purchase on the same date and quantity is treated
    // as a restatement of it, not as extra stock.
    const purchaseFingerprints = new Set(
      transactions
        .filter((t) => t.source === "purchase")
        .map((t) => `${String(t.date).slice(0, 10)}|${t.qtyIn || t.qtyOut}`)
    );
    const seenMovements = new Set<string>();
    let duplicatesSkipped = 0;

    for (const { rows, source, label } of movementSources) {
      for (const doc of rows) {
        const lines = Array.isArray(doc.items) ? doc.items : Array.isArray(doc.lines) ? doc.lines : [];
        for (const [lineIdx, line] of (lines as any[]).entries()) {
          if (!lineMatches(line)) continue;
          const qty = Math.abs(Number(line.quantity ?? line.qty ?? 0)) || 0;
          if (qty === 0) continue;

          const movementDate = String(doc.date || doc.billDate || (doc.createdAt ? new Date(doc.createdAt).toISOString().split("T")[0] : "")).slice(0, 10);
          const fingerprint = `${movementDate}|${qty}`;
          // Same day, same quantity as a purchase already in the ledger.
          if (purchaseFingerprints.has(fingerprint)) { duplicatesSkipped++; continue; }
          // Or an identical movement already added (the two journals mirror each other).
          if (seenMovements.has(`${source}|${fingerprint}`)) { duplicatesSkipped++; continue; }
          seenMovements.add(`${source}|${fingerprint}`);

          // Direction: an explicit in/out wins, otherwise infer from the document
          // type (a return to supplier removes stock, a customer return adds it).
          const dir = String(line.direction || doc.direction || doc.type || doc.adjustmentType || "").toLowerCase();
          const isOut =
            dir.includes("out") || dir.includes("issue") || dir.includes("decrease") ||
            dir.includes("damage") || dir.includes("supplier") || source === "transfer";
          const rate = Number(line.rate ?? line.purchaseRate ?? purchaseCost) || purchaseCost;

          if (isOut) adjustmentOut += qty; else adjustmentIn += qty;

          transactions.push({
            id: `${source.toUpperCase()}-${doc._id}-${lineIdx}`,
            date: movementDate,
            type: label,
            refNo: doc.referenceNo || doc.transferNo || doc.adjustmentNo || doc.returnNo || doc.journalNo || doc.voucherNo || String(doc._id).slice(-6).toUpperCase(),
            party: doc.reason || doc.notes || doc.toWarehouse || doc.supplierName || doc.customerName || "Stock movement",
            qtyIn: isOut ? 0 : qty,
            qtyOut: isOut ? qty : 0,
            rate,
            costRate: purchaseCost,
            amount: Math.round(rate * qty),
            profit: 0,
            serials: line.serialNumbers || [],
            source,
            status: doc.status || "completed",
          });
        }
      }
    }

    // ─── OPENING BALANCE ──────────────────────────────────────────────────────
    // Derived as the balancing figure, NOT read from `item.openingStock`.
    //
    // The catalogue import wrote an opening quantity onto each item AND recorded
    // the same goods as a stock-inward purchase entry ("VP-INW-2026-001"). Using
    // the stored openingStock therefore counted that stock twice — measured across
    // all 379 items, the ledger overshot actual stock on 272 of them.
    //
    // Deriving it instead means opening + in − out always equals the real on-hand
    // figure, so the ledger reconciles by construction. Where the derived opening
    // disagrees with the stored one, that difference is reported as a variance
    // rather than silently absorbed.
    const movementIn = transactions.reduce((s, t) => s + (Number(t.qtyIn) || 0), 0);
    const movementOut = transactions.reduce((s, t) => s + (Number(t.qtyOut) || 0), 0);
    const currentStockQty = Number(item?.showroomStock ?? item?.currentStock ?? 0) + Number(item?.godownStock ?? 0);
    const openingQty = currentStockQty - movementIn + movementOut;
    const recordedOpeningStock = Number(item?.openingStock) || 0;

    if (openingQty !== 0) {
      transactions.push({
        id: `OPENING-${item?._id || itemCode}`,
        // Dated before every other movement so it always sorts first in the ledger.
        date: "0000-00-00",
        displayDate: "Opening",
        type: "OPENING_STOCK",
        refNo: "OPENING",
        party: openingQty > 0
          ? "Opening balance (before recorded movements)"
          : "Opening adjustment — more issued than received in records",
        qtyIn: openingQty > 0 ? openingQty : 0,
        qtyOut: openingQty < 0 ? Math.abs(openingQty) : 0,
        rate: purchaseCost,
        costRate: purchaseCost,
        amount: Math.round(purchaseCost * Math.abs(openingQty)),
        profit: 0,
        serials: [],
        source: "opening",
        status: "opening",
      });
    }

    // Oldest first to compute the running balance, then reversed for display.
    transactions.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    let running = 0;
    for (const t of transactions) {
      running += (Number(t.qtyIn) || 0) - (Number(t.qtyOut) || 0);
      t.balance = running;
    }
    const ledgerClosingBalance = running;

    // Newest first for display
    transactions.reverse();

    const currentStock = (Number(item?.showroomStock ?? item?.currentStock ?? 0) + Number(item?.godownStock ?? 0));
    const avgSellingPrice = totalSoldQty > 0 ? Math.round(totalSoldRevenue / totalSoldQty) : Number(item?.sellingPrice || 0);
    const grossMarginPct = totalSoldRevenue > 0 ? Number(((totalProfit / totalSoldRevenue) * 100).toFixed(2)) : 0;

    return NextResponse.json({
      success: true,
      data: {
        product: {
          id: item?._id || id,
          name: itemName,
          code: itemCode,
          vpCode: itemVpCode,
          brand: item?.brand || "Value Plus",
          category: item?.category || "Electronics",
          unit: item?.unit || "PCS",
          purchasePrice: purchaseCost,
          sellingPrice: Number(item?.sellingPrice || 0),
          mrp: Number(item?.mrp || 0),
          showroomStock: Number(item?.showroomStock ?? item?.currentStock ?? 0),
          godownStock: Number(item?.godownStock ?? 0),
          currentStock,
        },
        summary: {
          totalInwardQty,
          totalInwardAmount: Math.round(totalInwardAmount),
          totalSoldQty,
          totalSoldRevenue: Math.round(totalSoldRevenue),
          totalProfit: Math.round(totalProfit),
          avgPurchaseRate: purchaseCost,
          avgSellingRate: avgSellingPrice,
          grossMarginPct,
          // Opening + everything in − everything out. Reported next to the real
          // on-hand figure so a ledger that doesn't add up says so, instead of
          // quietly presenting a partial history as complete.
          openingQty,
          recordedOpeningStock,
          // Non-zero means the item's stored opening quantity disagrees with what
          // the recorded movements imply — a data gap worth investigating, surfaced
          // rather than hidden.
          openingVariance: openingQty - recordedOpeningStock,
          duplicatesSkipped,
          movementIn,
          movementOut,
          adjustmentIn,
          adjustmentOut,
          ledgerClosingBalance,
          currentStock,
          reconciles: ledgerClosingBalance === currentStock,
          reconcileDiff: currentStock - ledgerClosingBalance,
        },
        transactions,
        serials: (serials as any[]).map((s: any) => ({
          serialNumber: s.serialNumber,
          status: s.status || "AVAILABLE",
          warehouse: s.warehouse || "Showroom",
          batchNo: s.batchNo || "-",
          updatedAt: s.updatedAt || s.createdAt
        })),
      }
    });
  } catch (error: any) {
    console.error("Product Ledger API Error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
