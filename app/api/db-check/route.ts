import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import mongoose from "mongoose";

export async function GET() {
  try {
    await connectToDatabase();
    const db = mongoose.connection?.db;
    
    if (!db) {
      return NextResponse.json({ success: false, message: "Database object not ready" }, { status: 500 });
    }

    const collections = await db.listCollections().toArray();
    const collectionNames = collections.map((col: any) => col.name);

    return NextResponse.json({
      success: true,
      message: "Successfully connected to MongoDB Atlas!",
      databaseName: db.databaseName,
      connectionState: mongoose.connection && mongoose.connection.readyState === 1 ? "Connected" : "Disconnected",
      collections: collectionNames,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        message: "Failed to connect to MongoDB",
        error: error.message || error.toString(),
      },
      { status: 500 }
    );
  }
}
