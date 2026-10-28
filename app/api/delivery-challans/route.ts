import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import DeliveryChallan from "@/models/DeliveryChallan";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const flowType = searchParams.get("flowType");
    const approvalStatus = searchParams.get("approvalStatus");
    const search = searchParams.get("search");

    await connectToDatabase();

    const query: any = {};
    if (flowType && flowType !== "all") query.flowType = flowType;
    if (approvalStatus && approvalStatus !== "all") query.approvalStatus = approvalStatus;
    if (search) {
      query.$or = [
        { challanNo: { $regex: search, $options: "i" } },
        { invoiceNumber: { $regex: search, $options: "i" } },
        { destinationParty: { $regex: search, $options: "i" } },
        { sourceParty: { $regex: search, $options: "i" } },
        { itemName: { $regex: search, $options: "i" } },
        { serialImei: { $regex: search, $options: "i" } },
        { vehicleNo: { $regex: search, $options: "i" } },
      ];
    }

    const challans = await DeliveryChallan.find(query).sort({ createdAt: -1 }).lean();
    return NextResponse.json({ success: true, data: challans || [] });
  } catch (error: any) {
    console.error("DeliveryChallan GET Error:", error);
    return NextResponse.json({ success: false, error: error.message, data: [] }, { status: 200 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    await connectToDatabase();

    const cnNumber = body.creditNoteRef || (body.flowType === "CNR" || body.type?.toLowerCase().includes("return") 
      ? `CN-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}` 
      : "");

    const payload = {
      ...body,
      challanNo: body.challanNo || `DC-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`,
      flowType: body.flowType || "CNR",
      approvalStatus: body.approvalStatus || (body.autoApprove ? "approved" : "pending"),
      creditNoteRef: cnNumber || undefined,
    };

    const challan = await DeliveryChallan.create(payload);

    // If it's a Customer Return / CNR Delivery Challan, automatically create the Credit Note in Invoice collection
    if (cnNumber && (payload.flowType === "CNR" || payload.type?.toLowerCase().includes("return"))) {
      try {
        const Invoice = (await import("@/models/Invoice")).default;
        const itemVal = Number(challan.itemPrice || 0);
        const qty = Number(challan.quantity || 1);
        const lineTotal = itemVal * qty;

        const creditNoteExists = await Invoice.findOne({ invoiceNumber: cnNumber });
        if (!creditNoteExists) {
          await Invoice.create({
            invoiceNumber: cnNumber,
            type: "credit-note",
            customerId: challan.customerId || "CUST-CLAIM",
            customerName: challan.sourceParty || challan.destinationParty || "Customer Return",
            customerPhone: challan.sourcePhone || challan.customerPhone || "",
            customerAddress: challan.sourceAddress || challan.destinationAddress || "",
            date: new Date().toISOString().split("T")[0],
            dueDate: new Date().toISOString().split("T")[0],
            status: "paid",
            notes: `Auto Credit Note from Delivery Challan #${challan.challanNo}${challan.defectDescription ? ` (Reason: ${challan.defectDescription})` : ""}`,
            items: [
              {
                itemId: challan.vpCode || "ITEM-RETURN",
                itemName: challan.itemName,
                itemCode: challan.vpCode || "",
                vpCode: challan.vpCode || "",
                description: challan.defectDescription || "Return Unit Restock",
                quantity: qty,
                unit: challan.unit || "PCS",
                rate: itemVal,
                discount: 0,
                discountType: "amount",
                taxableAmount: lineTotal,
                gstRate: 0,
                cgst: 0,
                sgst: 0,
                igst: 0,
                amount: lineTotal,
                serialNumber: challan.serialImei || "",
              },
            ],
            subtotal: lineTotal,
            discount: 0,
            taxableAmount: lineTotal,
            cgst: 0,
            sgst: 0,
            igst: 0,
            totalGst: 0,
            total: lineTotal,
            paidAmount: lineTotal,
            balanceAmount: 0,
          });
        }
      } catch (cnErr) {
        console.error("Auto Credit Note Creation in Challan POST Error:", cnErr);
      }
    }

    return NextResponse.json({ 
      success: true, 
      message: cnNumber ? `Delivery Challan created & Credit Note #${cnNumber} automatically generated!` : "Delivery Challan created successfully!", 
      data: challan 
    });
  } catch (error: any) {
    if (error.code === 11000) {
       return NextResponse.json({ success: false, error: "Challan number already exists" }, { status: 400 });
    }
    return NextResponse.json({ success: false, error: error.message }, { status: 400 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json();
    await connectToDatabase();
    
    if (!body.challanNo && !body._id) {
      return NextResponse.json({ success: false, error: "Challan identifier is required for update" }, { status: 400 });
    }

    const filter = body._id ? { _id: body._id } : { challanNo: body.challanNo };
    const existing = await DeliveryChallan.findOne(filter);
    if (!existing) {
      return NextResponse.json({ success: false, error: "Challan not found" }, { status: 404 });
    }

    // Handle special workflow actions
    if (body.action === "toggle-flow") {
      const nextFlow = existing.flowType === "CNR" ? "PR" : "CNR";
      existing.flowType = nextFlow;
      await existing.save();
      return NextResponse.json({ success: true, message: `Challan switched to ${nextFlow}`, data: existing });
    }

    if (body.action === "approve") {
      existing.approvalStatus = "approved";
      existing.approvedAt = new Date();
      existing.approvedBy = body.approvedBy || "STORE MANAGER";
      existing.status = "received";

      const cnNumber = existing.creditNoteRef || `CN-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
      existing.creditNoteRef = cnNumber;
      await existing.save();

      // Automatically create Credit Note in Invoice collection for Sales Credit Notes
      try {
        const Invoice = (await import("@/models/Invoice")).default;
        const itemVal = Number(existing.itemPrice || 0);
        const qty = Number(existing.quantity || 1);
        const lineTotal = itemVal * qty;

        const creditNoteExists = await Invoice.findOne({ invoiceNumber: cnNumber });
        if (!creditNoteExists && lineTotal >= 0) {
          await Invoice.create({
            invoiceNumber: cnNumber,
            type: "credit-note",
            customerId: "CUST-CLAIM",
            customerName: existing.sourceParty || "Customer Return",
            customerPhone: existing.sourcePhone || existing.customerPhone || "",
            customerAddress: existing.sourceAddress || "",
            date: new Date().toISOString().split("T")[0],
            dueDate: new Date().toISOString().split("T")[0],
            status: "paid",
            notes: `Auto Credit Note from Approved Challan #${existing.challanNo}${existing.defectDescription ? ` (Fault: ${existing.defectDescription})` : ""}`,
            items: [
              {
                itemId: existing.vpCode || "ITEM",
                itemName: existing.itemName,
                itemCode: existing.vpCode || "",
                vpCode: existing.vpCode || "",
                description: existing.defectDescription || "Return unit",
                quantity: qty,
                unit: existing.unit || "PCS",
                rate: itemVal,
                discount: 0,
                discountType: "amount",
                taxableAmount: lineTotal,
                gstRate: 0,
                cgst: 0,
                sgst: 0,
                igst: 0,
                amount: lineTotal,
                serialNumber: existing.serialImei || "",
              },
            ],
            subtotal: lineTotal,
            discount: 0,
            taxableAmount: lineTotal,
            cgst: 0,
            sgst: 0,
            igst: 0,
            totalGst: 0,
            total: lineTotal,
            paidAmount: lineTotal,
            balanceAmount: 0,
          });
        }
      } catch (cnErr) {
        console.error("Auto Credit Note Creation Error:", cnErr);
      }

      return NextResponse.json({ 
        success: true, 
        message: `Challan approved & Credit Note #${existing.creditNoteRef} automatically created!`, 
        data: existing 
      });
    }

    if (body.action === "reject") {
      existing.approvalStatus = "rejected";
      await existing.save();
      return NextResponse.json({ success: true, message: "Challan rejected", data: existing });
    }

    // Standard update
    const updatedChallan = await DeliveryChallan.findOneAndUpdate(filter, body, { new: true });
    return NextResponse.json({ success: true, message: "Challan updated successfully", data: updatedChallan });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const challanNo = searchParams.get("challanNo");
    const id = searchParams.get("id");
    
    if (!challanNo && !id) {
      return NextResponse.json({ success: false, error: "Challan number or ID is required" }, { status: 400 });
    }

    await connectToDatabase();
    if (id) {
      await DeliveryChallan.findByIdAndDelete(id);
    } else {
      await DeliveryChallan.findOneAndDelete({ challanNo });
    }

    return NextResponse.json({ success: true, message: "Challan deleted successfully" });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
