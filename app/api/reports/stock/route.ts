import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import Item from "@/models/Item";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const category = searchParams.get("category"); // specific category or "all"
    const warehouse = searchParams.get("warehouse") || searchParams.get("location");
    
    await connectToDatabase();
    
    let allItems = await Item.find({ status: "active" }).lean();

    // Only enforce per-warehouse isolation once items are actually tagged with a warehouse
    // at creation time. Until then, every item has warehouse === undefined, so the strict
    // branch below would zero out stock for every location except the Ashoka default.
    const hasWarehouseTagging = allItems.some((it: any) => it.warehouse);

    // The main showroom is tagged in several ways depending on how the item was created
    // ("Main Store - Gorakhpur", "Ashoka Enterprises (Kunraghat Showroom)", "Showroom", …).
    // Matching only on ashoka/kunraghat filtered out every real item — the whole catalog is
    // tagged "Main Store - Gorakhpur" — which is why this report returned 0 stock while the
    // Item Master (which already uses this wider match) showed all 379 products.
    const SHOWROOM_PATTERN = /showroom|ashoka|kunraghat|vp-?kun|main\s*store/i;
    const isShowroomName = (name: string) => SHOWROOM_PATTERN.test(name);

    // Whether the requested location actually scoped the catalog. Reported back so the
    // UI can say "showing all locations" rather than silently implying the filter held.
    let warehouseFilterApplied = false;

    if (warehouse && warehouse !== "all" && hasWarehouseTagging) {
      let scoped: any[];
      if (isShowroomName(warehouse)) {
        // Main showroom: untagged items plus anything tagged as a showroom/main store,
        // but never the godown.
        scoped = allItems.filter((it: any) =>
          !it.warehouse ||
          (isShowroomName(it.warehouse) && !/godown/i.test(it.warehouse))
        );
      } else {
        // A specific named location (e.g. a godown): exact match, with a substring
        // fallback so "Godown" still matches "GIDA Industrial Area Godown".
        const wanted = warehouse.toLowerCase().trim();
        scoped = allItems.filter((it: any) => {
          const wh = (it.warehouse || "").toLowerCase().trim();
          // Untagged stock belongs to the main showroom, never to a named location —
          // and an empty tag would otherwise satisfy `wanted.includes(wh)` for every name.
          if (!wh) return false;
          return wh === wanted || wh.includes(wanted) || wanted.includes(wh);
        });
      }

      // The warehouse master and the item tags can diverge — the master is seeded with
      // names like "Main Central Warehouse" while every real item is tagged
      // "Kunraghat Main Showroom" / "Main Store - Gorakhpur". Filtering on a location no
      // item carries produced an empty stock report for a catalog of 379 products, which
      // reads as "no data" rather than "no match". If a location scopes the catalog down
      // to nothing, the tagging isn't meaningful for it, so fall back to the whole
      // catalog and say so instead of reporting a misleading zero.
      if (scoped.length > 0) {
        allItems = scoped;
        warehouseFilterApplied = true;
      }
    }
    
    // ─── GROUP CLASSIFICATION ─────────────────────────────────────────────
    // The showroom has exactly two stock groups: Mobile and Electronics.
    // "Electronics" is an UMBRELLA — fridges, coolers, ACs, TVs, washing machines,
    // laptops, appliances and anything else all roll up into it. So we only need to
    // detect mobiles accurately; everything that is not a mobile IS electronics.
    // (The previous filters overlapped — "Smart TV" matched both the electronics
    // "tv" test and the mobile "smart" test, so it was counted twice.)
    const MOBILE_HINTS = [
      "mobile", "mob phone", "smartphone", "cellphone", "phone", "tablet", "ipad",
      "iphone", "galaxy", "redmi", "realme", "oppo", "vivo", "oneplus", "nord",
      "pixel", "xiaomi", "poco", "tecno", "infinix", "lava", "nokia", "motorola",
    ];

    const isMobileItem = (item: any) => {
      const cat = (item.category || "").toLowerCase();
      const name = (item.name || "").toLowerCase();
      const brand = (item.brand || "").toLowerCase();
      // A category naming a mobile is decisive; otherwise fall back to the product name.
      if (cat.includes("mob") || cat.includes("phone") || cat.includes("tablet")) return true;
      // Guard against "Smart TV" / "Smart Watch" being read as "smartphone".
      if (cat.includes("tv") || cat.includes("televis")) return false;
      return MOBILE_HINTS.some((h) => name.includes(h) || brand.includes(h));
    };

    // Stock is valued the same way everywhere: selling price, falling back to purchase
    // price. Previously the group tiles used `sellingPrice || 0` while the category
    // totals used `sellingPrice || purchasePrice`, so items priced only by purchase
    // cost showed ₹0 in the tiles but full value in the overall valuation.
    const unitPrice = (item: any) => item.sellingPrice || item.purchasePrice || 0;
    const stockValueOf = (item: any) => (item.currentStock || 0) * unitPrice(item);

    // Calculate category map dynamically
    const categoryMap: Record<string, { name: string; group: string; quantity: number; value: number; itemCount: number }> = {};
    let totalQty = 0;
    let totalVal = 0;

    for (const item of allItems) {
      const catName = item.category?.trim() || "General Electronics";
      const group = isMobileItem(item) ? "mobile" : "electronics";
      if (!categoryMap[catName]) {
        categoryMap[catName] = { name: catName, group, quantity: 0, value: 0, itemCount: 0 };
      }
      const qty = item.currentStock || 0;
      const itemVal = stockValueOf(item);

      categoryMap[catName].quantity += qty;
      categoryMap[catName].value += itemVal;
      categoryMap[catName].itemCount += 1;

      totalQty += qty;
      totalVal += itemVal;
    }

    const categoriesList = Object.values(categoryMap).sort((a, b) => b.value - a.value);

    const mobileItems = allItems.filter(isMobileItem);
    const electronicsItems = allItems.filter((it: any) => !isMobileItem(it));

    const sumQty = (items: any[]) => items.reduce((acc, it) => acc + (it.currentStock || 0), 0);
    const sumValue = (items: any[]) => items.reduce((acc, it) => acc + stockValueOf(it), 0);

    // Sub-categories rolled up inside each group, so the UI can show what "Electronics"
    // actually covers (Refrigerator, Cooler, AC, LED TV, ...) instead of it looking like
    // one narrow category sitting beside them.
    const groupCategories = (group: string) =>
      categoriesList.filter((c) => c.group === group).map((c) => ({
        name: c.name,
        quantity: c.quantity,
        value: c.value,
        itemCount: c.itemCount,
      }));

    const formatItemList = (items: any[]) =>
      items.map((it) => ({
        _id: it._id,
        code: it.code,
        vpCode: it.vpCode || it.code,
        name: it.name,
        category: it.category || "General",
        group: isMobileItem(it) ? "mobile" : "electronics",
        brand: it.brand || "Brand",
        availableQty: it.currentStock,
        totalQty: it.currentStock,
        sellingPrice: it.sellingPrice,
        purchasePrice: it.purchasePrice,
        stockValue: stockValueOf(it),
        isSerialized: it.isSerialized || false,
      }));

    let filteredItems = allItems;
    if (category && category !== "all") {
      const wanted = category.toLowerCase();
      // `category` accepts a group name ("electronics" / "mobile") as well as a specific
      // category, so "Electronics" returns every appliance rather than only items literally
      // categorised "Electronics".
      if (wanted === "electronics" || wanted === "mobile") {
        filteredItems = allItems.filter((it: any) => (isMobileItem(it) ? "mobile" : "electronics") === wanted);
      } else {
        filteredItems = allItems.filter((it: any) => (it.category || "").toLowerCase() === wanted);
      }
    }

    return NextResponse.json({
      success: true,
      warehouseFilterApplied,
      warehouseRequested: warehouse || "all",
      data: {
        warehouseFilterApplied,
        warehouseRequested: warehouse || "all",
        totalQuantity: totalQty,
        totalStockValue: totalVal,
        totalItemsCount: allItems.length,
        electronics: {
          quantity: sumQty(electronicsItems),
          value: sumValue(electronicsItems),
          count: electronicsItems.length,
          categories: groupCategories("electronics"),
        },
        mobile: {
          quantity: sumQty(mobileItems),
          value: sumValue(mobileItems),
          count: mobileItems.length,
          categories: groupCategories("mobile"),
        },
        categories: categoriesList,
      },
      categories: categoriesList,
      items: formatItemList(filteredItems),
      totalStockQuantity: totalQty,
      totalStockValue: totalVal,
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
