import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import Item from "@/models/Item";
import PurchaseEntry from "@/models/PurchaseEntry";
import Invoice from "@/models/Invoice";
import StockTransfer from "@/models/StockTransfer";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search") || "";
    const brand = searchParams.get("brand") || "";
    const category = searchParams.get("category") || "";
    const warehouse = searchParams.get("warehouse") || "";
    const stockStatus = searchParams.get("status") || "all";
    const startDate = searchParams.get("startDate") || "";
    const endDate = searchParams.get("endDate") || "";
    // "all" | "in" | "out" | "transfer" — lets the user look at only inward or only
    // outward movement instead of the combined ledger.
    const movement = searchParams.get("movement") || "all";

    // When a date range is supplied, every movement (purchase, sale, transfer) is
    // scoped to it, so "Stock In / Stock Out" report the period rather than all time.
    // `currentStock` stays live — on-hand quantity is a present-day fact, not a
    // period one — which is why it is deliberately left out of this filter.
    const hasDateFilter = Boolean(startDate && endDate);
    const rangeStart = hasDateFilter ? new Date(startDate) : null;
    const rangeEnd = hasDateFilter ? new Date(endDate) : null;
    if (rangeStart) rangeStart.setHours(0, 0, 0, 0);
    if (rangeEnd) rangeEnd.setHours(23, 59, 59, 999);

    const inRange = (value: any): boolean => {
      if (!hasDateFilter) return true;
      if (!value) return false; // undated rows can't be proven to fall in the window
      const d = new Date(value);
      if (isNaN(d.getTime())) return false;
      return d >= (rangeStart as Date) && d <= (rangeEnd as Date);
    };

    await connectToDatabase();

    // 1. Fetch Items with Warehouse Isolation
    const filter: any = {};
    if (brand && brand !== "all") filter.brand = brand;
    if (category && category !== "all") filter.category = category;
    
    if (warehouse && warehouse !== "all") {
      const isAshoka = warehouse.toLowerCase().includes("ashoka") || warehouse.toLowerCase().includes("kunraghat") || warehouse === "VP-KUN";
      if (!isAshoka) {
        filter.warehouse = { $regex: new RegExp(`^${warehouse.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") };
      } else {
        filter.$or = [
          { warehouse: { $exists: false } },
          { warehouse: "" },
          { warehouse: { $regex: /ashoka|kunraghat/i } }
        ];
      }
    }

    const items = await Item.find(filter).sort({ currentStock: -1, name: 1 }).lean();

    // 2. Fetch all related transactions concurrently
    const [purchaseEntries, invoices, stockTransfers] = await Promise.all([
      PurchaseEntry.find({}).sort({ billDate: -1, createdAt: -1 }).lean(),
      // Estimates never take stock out, so they are not a stock movement.
      Invoice.find({ type: { $ne: "proforma" } }).sort({ date: -1, createdAt: -1 }).lean(),
      StockTransfer.find({}).sort({ date: -1, createdAt: -1 }).lean(),
    ]);

    // Build lookup maps for fast matching
    const itemFlowList = items.map((item: any) => {
      const itemIdStr = item._id ? item._id.toString() : "";
      const itemCode = (item.code || "").toLowerCase();
      const itemName = (item.name || "").toLowerCase().trim();

      // --- MATCH INWARDS (PURCHASES) ---
      const inwards: any[] = [];
      for (const pe of purchaseEntries as any[]) {
        if (Array.isArray(pe.items)) {
          for (const line of pe.items) {
            const lineId = (line.itemId || "").toString();
            const lineName = (line.name || "").toLowerCase().trim();
            if (!inRange(pe.billDate || pe.createdAt)) continue;
            if (lineId === itemIdStr || lineName === itemName || (itemName && lineName && (itemName.includes(lineName) || lineName.includes(itemName)))) {
              inwards.push({
                date: pe.billDate || pe.createdAt,
                quantity: Number(line.quantity) || 1,
                rate: Number(line.rate) || item.purchasePrice || 0,
                billNo: pe.billNo,
                supplierName: pe.supplierName || "Direct Supplier",
                type: "INWARD",
              });
            }
          }
        }
      }

      // --- MATCH OUTWARDS (SALES INVOICES) ---
      const outwards: any[] = [];
      for (const inv of invoices as any[]) {
        if (Array.isArray(inv.items)) {
          for (const line of inv.items) {
            const lineId = (line.itemId || "").toString();
            const lineCode = (line.itemCode || "").toLowerCase();
            const lineName = (line.itemName || "").toLowerCase().trim();
            if (!inRange(inv.date || inv.createdAt)) continue;
            if (lineId === itemIdStr || lineCode === itemCode || lineName === itemName || (itemName && lineName && (itemName.includes(lineName) || lineName.includes(itemName)))) {
              outwards.push({
                date: inv.date || inv.createdAt,
                quantity: Number(line.quantity) || 1,
                rate: Number(line.rate) || item.sellingPrice || 0,
                invoiceNo: inv.invoiceNumber,
                customerName: inv.customerName || "Walk-in Customer",
                type: "OUTWARD",
              });
            }
          }
        }
      }

      // --- MATCH WAREHOUSE TRANSFERS ---
      const transfers: any[] = [];
      for (const st of stockTransfers as any[]) {
        if (Array.isArray(st.items)) {
          for (const line of st.items) {
            const lineId = (line.itemId || "").toString();
            const lineName = (line.itemName || "").toLowerCase().trim();
            if (!inRange(st.date || st.createdAt)) continue;
            if (lineId === itemIdStr || lineName === itemName || (itemName && lineName && (itemName.includes(lineName) || lineName.includes(itemName)))) {
              transfers.push({
                date: st.date || st.createdAt,
                quantity: Number(line.quantity) || 1,
                fromWarehouse: st.fromWarehouse || "Main Store",
                toWarehouse: st.toWarehouse || "Branch Store",
                transferNo: st.transferNo,
                status: st.status || "completed",
                type: "TRANSFER",
              });
            }
          }
        }
      }

      // Latest Inward. Opening stock has no date, so it is only offered as a fallback
      // when the whole history is being shown — inside a date range it would overstate
      // the period's inward quantity.
      const lastInward = inwards.length > 0 ? inwards[0] : (!hasDateFilter && item.openingStock > 0 ? {
        date: "Opening Stock",
        quantity: item.openingStock,
        rate: item.purchasePrice,
        billNo: "INITIAL-STOCK",
        supplierName: "Ashoka Enterprises Opening",
      } : null);

      // Latest Outward
      const lastOutward = outwards.length > 0 ? outwards[0] : null;

      // Latest Transfer
      const lastTransfer = transfers.length > 0 ? transfers[0] : null;

      // Combined Chronological Timeline, honouring the movement-type filter so the
      // ledger can show inward only, outward only, or transfers only.
      const showIn = movement === "all" || movement === "in";
      const showOut = movement === "all" || movement === "out";
      const showTransfer = movement === "all" || movement === "transfer";

      const timeline = [
        ...(!showIn ? [] : inwards).map((inw) => ({
          type: "INWARD",
          title: `Stock In (${inw.billNo})`,
          badge: `+${inw.quantity} ${item.unit || "Pcs"}`,
          date: inw.date,
          rate: inw.rate,
          refNo: inw.billNo,
          partyName: inw.supplierName,
          warehouse: item.warehouse || "Main Store - Gorakhpur",
        })),
        ...(!showOut ? [] : outwards).map((out) => ({
          type: "OUTWARD",
          title: `Stock Out (${out.invoiceNo})`,
          badge: `-${out.quantity} ${item.unit || "Pcs"}`,
          date: out.date,
          rate: out.rate,
          refNo: out.invoiceNo,
          partyName: out.customerName,
          warehouse: item.warehouse || "Showroom",
        })),
        ...(!showTransfer ? [] : transfers).map((tr) => ({
          type: "TRANSFER",
          title: `Warehouse Transfer (${tr.transferNo})`,
          badge: `${tr.quantity} ${item.unit || "Pcs"} (${tr.fromWarehouse} ➔ ${tr.toWarehouse})`,
          date: tr.date,
          refNo: tr.transferNo,
          partyName: `${tr.fromWarehouse} to ${tr.toWarehouse}`,
          status: tr.status,
          warehouse: tr.toWarehouse,
        })),
      ].sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());

      if (timeline.length === 0 && item.openingStock > 0 && !hasDateFilter && showIn) {
        timeline.push({
          type: "INWARD",
          title: "Opening Stock Register",
          badge: `+${item.openingStock} ${item.unit || "Pcs"}`,
          date: "Opening Balance",
          rate: item.purchasePrice,
          refNo: "INIT-001",
          partyName: "Opening Stock Register",
          warehouse: item.warehouse || "Main Store",
        });
      }

      return {
        _id: item._id,
        code: item.code,
        vpCode: item.vpCode || item.code,
        name: item.name,
        brand: item.brand || "General",
        category: item.category || "Appliances",
        currentStock: Number(item.currentStock) || 0,
        openingStock: Number(item.openingStock) || 0,
        reorderLevel: Number(item.reorderLevel) || 3,
        purchasePrice: Number(item.purchasePrice) || 0,
        sellingPrice: Number(item.sellingPrice) || 0,
        mrp: Number(item.mrp) || 0,
        unit: item.unit || "Pcs",
        hsnCode: item.hsnCode || "8528",
        warehouse: item.warehouse || "Main Store - Gorakhpur",
        lastInward,
        lastOutward,
        lastTransfer,
        // Opening stock counts as inward only when reporting all time; within a date
        // range it is a pre-existing balance, not movement that happened in the period.
        totalInwardQty: inwards.reduce((acc, x) => acc + x.quantity, 0) + (hasDateFilter ? 0 : (item.openingStock || 0)),
        totalOutwardQty: outwards.reduce((acc, x) => acc + x.quantity, 0),
        totalTransferQty: transfers.reduce((acc, x) => acc + x.quantity, 0),
        movementCount: inwards.length + outwards.length + transfers.length,
        timeline,
      };
    });

    // Filtering by search & stockStatus if provided
    let filteredResults = itemFlowList;
    if (search) {
      const q = search.toLowerCase();
      filteredResults = filteredResults.filter(
        (i) =>
          i.name.toLowerCase().includes(q) ||
          i.code.toLowerCase().includes(q) ||
          (i.vpCode && i.vpCode.toLowerCase().includes(q)) ||
          i.brand.toLowerCase().includes(q) ||
          i.category.toLowerCase().includes(q)
      );
    }

    if (stockStatus === "in-stock") {
      filteredResults = filteredResults.filter((i) => i.currentStock > i.reorderLevel);
    } else if (stockStatus === "low-stock") {
      filteredResults = filteredResults.filter((i) => i.currentStock > 0 && i.currentStock <= i.reorderLevel);
    } else if (stockStatus === "out-of-stock") {
      filteredResults = filteredResults.filter((i) => i.currentStock === 0);
    } else if (stockStatus === "recent-inward") {
      filteredResults = filteredResults.filter((i) => !!i.lastInward);
    }

    // When looking at a specific movement type — or a date range — only show items that
    // actually moved that way, otherwise the list is mostly rows of zeroes.
    if (movement === "in") {
      filteredResults = filteredResults.filter((i) => i.totalInwardQty > 0);
    } else if (movement === "out") {
      filteredResults = filteredResults.filter((i) => i.totalOutwardQty > 0);
    } else if (movement === "transfer") {
      filteredResults = filteredResults.filter((i) => i.totalTransferQty > 0);
    } else if (hasDateFilter) {
      filteredResults = filteredResults.filter((i) => i.movementCount > 0);
    }

    // High Level Summary Metrics — computed from the same filtered set the table shows,
    // so the cards and the rows below them always agree.
    const summarySource = filteredResults;
    const totalSKUs = summarySource.length;
    const totalCurrentStock = summarySource.reduce((acc, i) => acc + i.currentStock, 0);
    const totalStockValuation = summarySource.reduce((acc, i) => acc + i.currentStock * i.purchasePrice, 0);
    const totalInwardUnits = summarySource.reduce((acc, i) => acc + i.totalInwardQty, 0);
    const totalOutwardUnits = summarySource.reduce((acc, i) => acc + i.totalOutwardQty, 0);
    const totalTransfers = hasDateFilter
      ? stockTransfers.filter((st: any) => inRange(st.date || st.createdAt)).length
      : stockTransfers.length;

    return NextResponse.json({
      success: true,
      summary: {
        totalSKUs,
        totalCurrentStock,
        totalStockValuation: Math.round(totalStockValuation),
        totalInwardUnits,
        totalOutwardUnits,
        totalTransfers,
      },
      filters: { startDate, endDate, movement, dateFiltered: hasDateFilter },
      data: filteredResults,
    });
  } catch (error: any) {
    console.error("Stock flow fetch error:", error);
    return NextResponse.json({ success: false, error: error.message || "Failed to load stock flow" }, { status: 500 });
  }
}
