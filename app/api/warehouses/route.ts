import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import Warehouse from "@/models/Warehouse";
import Item from "@/models/Item";

export async function GET() {
  try {
    await connectToDatabase();
    // Clean up any legacy generic dummy entries
    await Warehouse.deleteMany({ name: { $in: ["Showroom", "Godown", "Main Warehouse"] } });

    let warehouses = await Warehouse.find({}).sort({ createdAt: 1 }).lean();
    
    if (!warehouses || warehouses.length === 0) {
      const defaultWarehouses = [
        {
          name: "Ashoka Enterprises (Kunraghat Showroom)",
          code: "VP-KUN",
          type: "showroom",
          address: "H. No. 116, Near Shanti Marriage House, Deoria Rd, Kunraghat",
          city: "Gorakhpur",
          state: "Uttar Pradesh",
          pincode: "273008",
          contactPerson: "Shivam Rai (Store Head)",
          phone: "+91 9140860604",
          email: "kunraghat@valueplus.com",
          status: "active",
          isDefault: true,
        },
        {
          name: "Value Plus (Deoria Road Branch)",
          code: "VP-DEO",
          type: "showroom",
          address: "Deoria Bypass Road, Near AIIMS, Gorakhpur",
          city: "Gorakhpur",
          state: "Uttar Pradesh",
          pincode: "273010",
          contactPerson: "Branch Incharge",
          phone: "+91 9876543210",
          email: "deoria.road@valueplus.com",
          status: "active",
          isDefault: false,
        },
        {
          name: "Gorakhpur Central Godown & Logistics Hub",
          code: "GDN-MAIN",
          type: "godown",
          address: "Plot 42, Transport Nagar Central Logistics Hub, Gorakhpur",
          city: "Gorakhpur",
          state: "Uttar Pradesh",
          pincode: "273016",
          contactPerson: "Ram Kumar (Godown Incharge)",
          phone: "+91 9876543211",
          email: "central.godown@valueplus.com",
          status: "active",
          isDefault: false,
        },
        {
          name: "GIDA Industrial Area Godown",
          code: "GDN-GIDA",
          type: "godown",
          address: "Sector 13, GIDA Industrial Area, Gorakhpur",
          city: "Gorakhpur",
          state: "Uttar Pradesh",
          pincode: "273209",
          contactPerson: "Suresh Yadav (Logistics Manager)",
          phone: "+91 9876543212",
          email: "gida.godown@valueplus.com",
          status: "active",
          isDefault: false,
        }
      ];

      await Warehouse.insertMany(defaultWarehouses);
      warehouses = await Warehouse.find({}).sort({ createdAt: 1 }).lean();
    }

    return NextResponse.json({ success: true, data: warehouses });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    await connectToDatabase();
    const warehouse = await Warehouse.create(body);
    return NextResponse.json({ success: true, data: warehouse });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 400 });
  }
}

export async function PUT(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ success: false, error: "ID is required" }, { status: 400 });
    }

    const body = await req.json();
    await connectToDatabase();

    const updated = await Warehouse.findByIdAndUpdate(id, body, { new: true, runValidators: true });
    if (!updated) {
      return NextResponse.json({ success: false, error: "Warehouse not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: updated });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ success: false, error: "ID is required" }, { status: 400 });
    }

    await connectToDatabase();

    // A warehouse that still has stock on record can't be deleted out from
    // under that stock — disable it instead (status: "inactive") if it's no
    // longer in use.
    const hasStock = await Item.exists({
      stockByWarehouse: { $elemMatch: { warehouseId: id, qty: { $gt: 0 } } },
    });
    if (hasStock) {
      return NextResponse.json(
        {
          success: false,
          error: "This warehouse still has stock recorded against it. Move or clear its stock first, or mark it inactive instead of deleting it.",
        },
        { status: 400 }
      );
    }

    const deletedWarehouse = await Warehouse.findByIdAndDelete(id);

    if (!deletedWarehouse) {
      return NextResponse.json({ success: false, error: "Warehouse not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, message: "Warehouse deleted successfully" });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
