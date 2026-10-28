import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import Attendance from "@/models/Attendance";
import User from "@/models/User";
import ShiftSetting from "@/models/ShiftSetting";

// Helper: Get IST Date string (YYYY-MM-DD)
function getISTDate(d = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  } catch (e) {
    return d.toISOString().split("T")[0];
  }
}

// Helper: Get IST Time formatted (e.g., "10:15 AM")
function getISTTime(d = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    }).format(d);
  } catch (e) {
    return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
  }
}

// Helper: Convert time string (12-hr or 24-hr) to minutes from midnight
function timeStringToMinutes(timeStr: string): number {
  if (!timeStr || timeStr === "--") return 0;
  
  // Try 12-hour format: "10:15 AM" or "06:30 PM"
  const match12 = timeStr.match(/(\d+):(\d+)\s*(AM|PM)?/i);
  if (match12) {
    let hours = parseInt(match12[1], 10);
    const minutes = parseInt(match12[2], 10);
    const meridiem = match12[3]?.toUpperCase();

    if (meridiem === "PM" && hours < 12) hours += 12;
    if (meridiem === "AM" && hours === 12) hours = 0;
    return hours * 60 + minutes;
  }

  // Try 24-hour format: "18:00"
  const match24 = timeStr.match(/(\d+):(\d+)/);
  if (match24) {
    const hours = parseInt(match24[1], 10);
    const minutes = parseInt(match24[2], 10);
    return hours * 60 + minutes;
  }

  return 0;
}

// GET Attendance Records
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const dateParam = searchParams.get("date");
    const staffName = searchParams.get("staff");
    const staffId = searchParams.get("staffId");
    const month = searchParams.get("month"); // e.g. "2026-08"
    
    await connectToDatabase();
    
    const filter: any = {};
    
    if (dateParam && dateParam !== "all") {
      filter.date = dateParam;
    } else if (!dateParam && !month) {
      // Default to today in IST
      filter.date = getISTDate();
    }

    if (month) {
      filter.date = { $regex: `^${month}` };
    }
    
    if (staffName && staffName !== "all") {
      filter.staffName = staffName;
    }
    if (staffId) {
      filter.staffId = staffId;
    }
    
    const records = await Attendance.find(filter).sort({ date: -1, createdAt: -1 }).lean();
    return NextResponse.json({ success: true, data: records });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// Check-in / Check-out / Leave / Manual / Bulk Attendance
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      action,
      staffName,
      staffId,
      staffEmail,
      staffRole,
      userId,
      date,
      checkInTime: customCheckInTime,
      checkOutTime: customCheckOutTime,
      status: customStatus,
      notes,
      leaveType,
      leaveReason,
      advanceRequested,
      branchName,
      records: bulkRecords,
    } = body;
    
    await connectToDatabase();

    // Fetch active shift settings or default
    let shift = await ShiftSetting.findOne().sort({ updatedAt: -1 });
    if (!shift) {
      shift = await ShiftSetting.create({
        shiftName: "Showroom Shift (10:00 AM - 06:00 PM)",
        startTime: "10:00",
        endTime: "18:00",
        lateGraceMinutes: 15,
        halfDayLateCutoff: "12:00",
        minHoursForFullDay: 7.5,
        minHoursForHalfDay: 4.0,
      });
    }

    const todayIST = getISTDate();
    const currentISTTime = getISTTime();
    const targetDate = date || todayIST;

    // ─────────────────────────────────────────────────────────────
    // 1. ACTION: CHECK-IN
    // ─────────────────────────────────────────────────────────────
    if (action === "check_in") {
      if (!staffName) {
        return NextResponse.json({ success: false, error: "Staff name is required for Check-In" }, { status: 400 });
      }

      let record = await Attendance.findOne({ staffName, date: targetDate });
      
      if (record && record.checkInTime && record.checkInTime !== "--") {
        return NextResponse.json({
          success: false,
          error: `${staffName} is already checked in today at ${record.checkInTime}`,
        }, { status: 400 });
      }

      const checkInMinutes = timeStringToMinutes(currentISTTime);
      const shiftStartMinutes = timeStringToMinutes(shift.startTime);
      const graceMinutes = shift.lateGraceMinutes || 15;
      const halfDayCutoffMinutes = timeStringToMinutes(shift.halfDayLateCutoff || "12:00");

      let calculatedStatus: "Present" | "Late" | "Half-Day" = "Present";
      let isLate = false;

      if (checkInMinutes > halfDayCutoffMinutes) {
        calculatedStatus = "Half-Day";
        isLate = true;
      } else if (checkInMinutes > shiftStartMinutes + graceMinutes) {
        calculatedStatus = "Late";
        isLate = true;
      }

      const statusRemark = calculatedStatus === "Half-Day"
        ? `Checked in past half-day cutoff (${currentISTTime})`
        : calculatedStatus === "Late"
        ? `Checked in late at ${currentISTTime} (Grace: ${shift.startTime} + ${graceMinutes}m)`
        : `Checked in on time at ${currentISTTime}`;

      if (record) {
        record.checkInTime = currentISTTime;
        record.status = calculatedStatus;
        record.isLate = isLate;
        record.notes = notes || statusRemark;
        record.shiftName = shift.shiftName;
        record.branchName = branchName || record.branchName;
        if (staffRole) record.staffRole = staffRole;
        if (staffEmail) record.staffEmail = staffEmail;
        if (staffId) record.staffId = staffId;
        if (userId) record.userId = userId;
        await record.save();
      } else {
        record = await Attendance.create({
          staffName,
          staffId: staffId || "",
          staffEmail: staffEmail || "",
          staffRole: staffRole || "salesman",
          userId: userId || "",
          branchName: branchName || "Ashoka Enterprises (Kunraghat Showroom)",
          date: targetDate,
          checkInTime: currentISTTime,
          status: calculatedStatus,
          isLate,
          shiftName: shift.shiftName,
          notes: notes || statusRemark,
        });
      }

      return NextResponse.json({
        success: true,
        data: record,
        message: `✅ ${staffName} Checked In at ${currentISTTime} (${calculatedStatus})`,
      });
    }

    // ─────────────────────────────────────────────────────────────
    // 2. ACTION: CHECK-OUT
    // ─────────────────────────────────────────────────────────────
    if (action === "check_out") {
      if (!staffName) {
        return NextResponse.json({ success: false, error: "Staff name is required for Check-Out" }, { status: 400 });
      }

      let record = await Attendance.findOne({ staffName, date: targetDate });
      
      if (!record || !record.checkInTime || record.checkInTime === "--") {
        return NextResponse.json({
          success: false,
          error: `No active Check-In found for ${staffName} on ${targetDate}. Please Check-In first.`,
        }, { status: 400 });
      }

      if (record.checkOutTime && record.checkOutTime !== "--") {
        return NextResponse.json({
          success: false,
          error: `${staffName} has already checked out for today at ${record.checkOutTime}`,
        }, { status: 400 });
      }

      record.checkOutTime = currentISTTime;

      // Calculate working minutes
      const inMin = timeStringToMinutes(record.checkInTime);
      const outMin = timeStringToMinutes(currentISTTime);
      const durationMinutes = Math.max(0, outMin - inMin);
      record.workingDurationMinutes = durationMinutes;

      const workedHours = durationMinutes / 60;
      const minFullDayHours = shift.minHoursForFullDay || 7.5;
      const minHalfDayHours = shift.minHoursForHalfDay || 4.0;
      const shiftEndMinutes = timeStringToMinutes(shift.endTime);

      let isEarlyCheckout = false;

      // Check if checkout is before required full-day hours or before shift end
      if (!shift.allowEarlyCheckoutWithoutPenalty) {
        if (workedHours < minHalfDayHours) {
          // Worked less than half-day minimum
          record.status = "Half-Day";
          isEarlyCheckout = true;
          record.notes = (record.notes ? record.notes + " | " : "") + `Early Check-Out at ${currentISTTime} (${workedHours.toFixed(1)} hrs < min ${minHalfDayHours} hrs required)`;
        } else if (workedHours < minFullDayHours || outMin < shiftEndMinutes) {
          // Worked between half-day and full-day minimum -> Half Day
          record.status = "Half-Day";
          isEarlyCheckout = true;
          record.notes = (record.notes ? record.notes + " | " : "") + `Early Check-Out at ${currentISTTime} (${workedHours.toFixed(1)} hrs worked, shift ends ${shift.endTime}). Marked as Half-Day.`;
        } else {
          // Completed full shift
          isEarlyCheckout = false;
          if (record.status !== "Late") {
            record.status = "Present";
          }
          record.notes = (record.notes ? record.notes + " | " : "") + `Shift Completed (${workedHours.toFixed(1)} hrs)`;
        }
      } else {
        if (record.status !== "Late") {
          record.status = "Present";
        }
      }

      record.isEarlyCheckout = isEarlyCheckout;
      await record.save();

      const hoursDisplay = `${Math.floor(durationMinutes / 60)}h ${durationMinutes % 60}m`;
      return NextResponse.json({
        success: true,
        data: record,
        message: `🏁 ${staffName} Checked Out at ${currentISTTime} (Worked: ${hoursDisplay}, Status: ${record.status})`,
      });
    }

    // ─────────────────────────────────────────────────────────────
    // 3. ACTION: MANUAL ENTRY / SAVE DAILY ATTENDANCE (ADMIN / HR)
    // ─────────────────────────────────────────────────────────────
    if (action === "manual_entry" || action === "save_daily_attendance") {
      if (!staffName) {
        return NextResponse.json({ success: false, error: "Staff name is required" }, { status: 400 });
      }

      const inTime = customCheckInTime || "--";
      const outTime = customCheckOutTime || "--";
      
      let durationMinutes = 0;
      if (inTime !== "--" && outTime !== "--") {
        const inM = timeStringToMinutes(inTime);
        const outM = timeStringToMinutes(outTime);
        durationMinutes = Math.max(0, outM - inM);
      }

      let statusToSet = customStatus || "Present";
      if (!customStatus && inTime !== "--" && outTime !== "--") {
        const workedHours = durationMinutes / 60;
        statusToSet = workedHours >= (shift.minHoursForFullDay || 7.5) ? "Present" : "Half-Day";
      }

      const record = await Attendance.findOneAndUpdate(
        { staffName, date: targetDate },
        {
          staffName,
          staffId: staffId || "",
          staffEmail: staffEmail || "",
          staffRole: staffRole || "salesman",
          userId: userId || "",
          branchName: branchName || "Ashoka Enterprises (Kunraghat Showroom)",
          date: targetDate,
          checkInTime: inTime,
          checkOutTime: outTime,
          workingDurationMinutes: durationMinutes,
          status: statusToSet,
          shiftName: shift.shiftName,
          notes: notes || `Admin updated attendance for ${targetDate}`,
        },
        { upsert: true, new: true }
      );

      return NextResponse.json({
        success: true,
        data: record,
        message: `Attendance updated for ${staffName} on ${targetDate}`,
      });
    }

    // ─────────────────────────────────────────────────────────────
    // 4. ACTION: BULK MARK PRESENT (ALL STAFF FOR A DATE)
    // ─────────────────────────────────────────────────────────────
    if (action === "bulk_mark_present") {
      const activeUsers = await User.find({ status: "active" }).lean();
      const defaultInTime = shift.startTime ? `${shift.startTime.split(":")[0] > "12" ? Number(shift.startTime.split(":")[0]) - 12 : shift.startTime.split(":")[0]}:${shift.startTime.split(":")[1]} AM` : "10:00 AM";

      const promises = activeUsers.map(async (u) => {
        return Attendance.findOneAndUpdate(
          { staffName: u.name, date: targetDate },
          {
            $setOnInsert: {
              staffName: u.name,
              staffId: u._id.toString(),
              staffEmail: u.email,
              staffRole: u.role,
              userId: u._id.toString(),
              branchName: u.assignedWarehouseName || branchName || "Kunraghat Showroom",
              date: targetDate,
              checkInTime: defaultInTime,
              checkOutTime: "--",
              workingDurationMinutes: 0,
              status: "Present",
              shiftName: shift.shiftName,
              notes: "Bulk marked present by Store Manager",
            },
          },
          { upsert: true, new: true }
        );
      });

      await Promise.all(promises);

      return NextResponse.json({
        success: true,
        message: `Marked ${activeUsers.length} staff members Present for ${targetDate}`,
      });
    }

    // ─────────────────────────────────────────────────────────────
    // 5. ACTION: APPLY LEAVE
    // ─────────────────────────────────────────────────────────────
    if (action === "apply_leave") {
      if (!staffName) {
        return NextResponse.json({ success: false, error: "Staff name is required" }, { status: 400 });
      }

      let record = await Attendance.findOne({ staffName, date: targetDate });
      if (record) {
        record.status = "On Leave";
        record.leaveType = leaveType || "Casual";
        record.leaveStatus = "Pending";
        record.leaveReason = leaveReason || "Personal Leave";
        await record.save();
      } else {
        record = await Attendance.create({
          staffName,
          staffId: staffId || "",
          staffEmail: staffEmail || "",
          staffRole: staffRole || "salesman",
          userId: userId || "",
          date: targetDate,
          checkInTime: "--",
          checkOutTime: "--",
          workingDurationMinutes: 0,
          status: "On Leave",
          leaveType: leaveType || "Casual",
          leaveStatus: "Pending",
          leaveReason: leaveReason || "Personal Leave",
          branchName: branchName || "Kunraghat Showroom",
        });
      }
      return NextResponse.json({ success: true, data: record, message: `Leave application submitted for ${staffName}` });
    }

    // ─────────────────────────────────────────────────────────────
    // 6. ACTION: REQUEST ADVANCE
    // ─────────────────────────────────────────────────────────────
    if (action === "request_advance") {
      const amount = Number(advanceRequested || 0);
      if (amount <= 0) {
        return NextResponse.json({ success: false, error: "Valid advance amount is required" }, { status: 400 });
      }
      await User.findOneAndUpdate(
        { name: staffName },
        { $inc: { advanceBalance: amount } }
      );
      return NextResponse.json({
        success: true,
        message: `Advance loan request of ₹${amount.toLocaleString("en-IN")} submitted for ${staffName}!`,
      });
    }

    return NextResponse.json({ success: false, error: "Invalid action." }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// DELETE Attendance Record
export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ success: false, error: "Attendance Record ID is required" }, { status: 400 });
    }
    await connectToDatabase();
    await Attendance.findByIdAndDelete(id);
    return NextResponse.json({ success: true, message: "Attendance record deleted successfully" });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
