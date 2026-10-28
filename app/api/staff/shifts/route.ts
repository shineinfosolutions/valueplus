import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import ShiftSetting from "@/models/ShiftSetting";

const DEFAULT_SHIFT = {
  shiftName: "Showroom Shift (10:00 AM - 06:00 PM)",
  startTime: "10:00",
  endTime: "18:00",
  lateGraceMinutes: 15,
  halfDayLateCutoff: "12:00",
  minHoursForFullDay: 7.5,
  minHoursForHalfDay: 4.0,
  allowEarlyCheckoutWithoutPenalty: false,
  branchName: "All Branches",
  updatedBy: "SuperAdmin",
};

// GET active shift settings
export async function GET() {
  try {
    await connectToDatabase();
    let shift = await ShiftSetting.findOne().sort({ updatedAt: -1 });
    if (!shift) {
      shift = await ShiftSetting.create(DEFAULT_SHIFT);
    }
    return NextResponse.json({ success: true, data: shift });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message, data: DEFAULT_SHIFT }, { status: 500 });
  }
}

// POST / PUT update shift settings
export async function POST(req: Request) {
  try {
    const body = await req.json();
    await connectToDatabase();

    const {
      shiftName = "Showroom Shift (10:00 AM - 06:00 PM)",
      startTime = "10:00",
      endTime = "18:00",
      lateGraceMinutes = 15,
      halfDayLateCutoff = "12:00",
      minHoursForFullDay = 7.5,
      minHoursForHalfDay = 4.0,
      allowEarlyCheckoutWithoutPenalty = false,
      branchName = "All Branches",
      updatedBy = "Store Manager",
    } = body;

    let shift = await ShiftSetting.findOne().sort({ updatedAt: -1 });
    if (shift) {
      shift.shiftName = shiftName;
      shift.startTime = startTime;
      shift.endTime = endTime;
      shift.lateGraceMinutes = Number(lateGraceMinutes);
      shift.halfDayLateCutoff = halfDayLateCutoff;
      shift.minHoursForFullDay = Number(minHoursForFullDay);
      shift.minHoursForHalfDay = Number(minHoursForHalfDay);
      shift.allowEarlyCheckoutWithoutPenalty = !!allowEarlyCheckoutWithoutPenalty;
      shift.branchName = branchName;
      shift.updatedBy = updatedBy;
      await shift.save();
    } else {
      shift = await ShiftSetting.create({
        shiftName,
        startTime,
        endTime,
        lateGraceMinutes: Number(lateGraceMinutes),
        halfDayLateCutoff,
        minHoursForFullDay: Number(minHoursForFullDay),
        minHoursForHalfDay: Number(minHoursForHalfDay),
        allowEarlyCheckoutWithoutPenalty: !!allowEarlyCheckoutWithoutPenalty,
        branchName,
        updatedBy,
      });
    }

    return NextResponse.json({
      success: true,
      data: shift,
      message: `Shift timings updated successfully! (${startTime} to ${endTime})`,
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
