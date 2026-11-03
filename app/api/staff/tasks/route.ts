import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import StaffTask from "@/models/StaffTask";
import { notifyAssignee } from "@/lib/notify";
import { getActor } from "@/lib/requirePermission";
import User from "@/models/User";

/** Roles that see and manage every staff member's tasks. */
const TASK_MANAGER_ROLES = ["admin", "superadmin", "manager", "hr"];
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const exactName = (name: string) => ({ $regex: new RegExp(`^\\s*${escapeRegex(name.trim())}\\s*$`, "i") });
const isGroupAssignee = (name: any) => /^(all staff|sales staff|admin \(self\))$/i.test(String(name || "").trim());

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

/** "Sell 2 × Haier AC (₹50,000) by 25 Oct" — what a target asks for, in one line. */
function describeTask(t: any): { title: string; message: string; type: "target_assigned" | "task_assigned" } {
  const due = t.dueDate ? ` by ${t.dueDate}${t.dueTime ? " " + t.dueTime : ""}` : "";
  if (t.taskType === "sales_target") {
    const what = [
      Number(t.targetQty) > 0 ? `${t.targetQty} ×` : "",
      t.targetProduct || t.targetBrand || "",
    ].filter(Boolean).join(" ");
    const amount = Number(t.targetAmount) > 0 ? ` (${inr(Number(t.targetAmount))})` : "";
    return {
      type: "target_assigned",
      title: `🎯 New sales target: ${t.taskTitle}`,
      message: `${what ? "Sell " + what : "Target"}${amount}${due}.${t.description ? " " + t.description : ""}`,
    };
  }
  return {
    type: "task_assigned",
    title: `📋 New task: ${t.taskTitle}`,
    message: `${t.priority ? t.priority + " priority" : "Task"}${due}.${t.description ? " " + t.description : ""}`,
  };
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const assignedStaff = searchParams.get("staff");
    const status = searchParams.get("status");

    await connectToDatabase();

    const filter: any = {};

    // Who is asking decides what they see — not a name sent by the page. Staff
    // get only tasks given to them (by id, or by their exact full name — never
    // a first name, which matched "Amit Singh" to "Amit Kumar Singh"), tasks
    // for everyone, and tasks they created themselves.
    const actor = await getActor().catch(() => null);
    if (!actor) {
      return NextResponse.json({ success: false, error: "You must be signed in to see tasks." }, { status: 401 });
    }
    if (!TASK_MANAGER_ROLES.includes(actor.role)) {
      const isSales = ["salesman", "sales"].includes(actor.role);
      filter.$or = [
        ...(actor.id ? [{ assignedStaffId: actor.id }] : []),
        { assignedStaff: exactName(actor.name) },
        { assignedStaff: "All Staff" },
        ...(isSales ? [{ assignedStaff: "Sales Staff" }] : []),
        { createdBy: exactName(actor.name) },
      ];
    } else if (assignedStaff && assignedStaff !== "all") {
      filter.$or = [
        { assignedStaff: exactName(assignedStaff) },
        { assignedStaff: "All Staff" },
        { assignedStaff: "Sales Staff" },
      ];
    }
    
    if (status && status !== "all") {
      filter.status = status;
    }
    
    const tasks = await StaffTask.find(filter).sort({ dueDate: 1, createdAt: -1 }).lean();
    return NextResponse.json({ success: true, data: tasks });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    await connectToDatabase();
    
    // Auto-populate assignedDate if not provided
    const payload = {
      ...body,
      assignedDate: body.assignedDate || (() => {
        try {
          return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
        } catch (e) {
          return new Date().toISOString().split("T")[0];
        }
      })(),
      currentQty: Number(body.currentQty) || 0,
      currentAmount: Number(body.currentAmount) || 0,
    };

    // The same task for several people (`alsoAssignTo`): each gets a copy of their own, so status, progress
    // and "Read by" stay per person; the copies share a groupId.
    const { alsoAssignTo, ...base } = payload;
    const names: string[] = Array.from(
      new Set(
        [String(base.assignedStaff || ""), ...(Array.isArray(alsoAssignTo) ? alsoAssignTo.map(String) : [])]
          .map((n) => n.trim())
          .filter(Boolean)
      )
    );
    if (names.length === 0) return NextResponse.json({ success: false, error: "Choose who the task is for." }, { status: 400 });
    const groupId = names.length > 1 ? `TG-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}` : undefined;

    const actor = await getActor().catch(() => null);
    const tasks: any[] = [];
    for (const name of names) {
      const one: any = { ...base, assignedStaff: name, groupId };
      if (name !== String(base.assignedStaff || "").trim()) delete one.assignedStaffId;
      // Remember the person's id, so the task follows them rather than a spelling.
      if (!one.assignedStaffId && !isGroupAssignee(name)) {
        const person: any = await User.findOne({ name: exactName(name) }, { _id: 1 }).lean();
        if (person) one.assignedStaffId = String(person._id);
      }
      const task = await StaffTask.create(one);
      tasks.push(task);

      // The person (or group) it is given to sees it in their bell straight away.
      await notifyAssignee(task.assignedStaff, task.assignedStaffId, {
        ...describeTask(task),
        link: "/staff/tasks",
        createdBy: actor?.name || String(body.createdBy || ""),
        refType: "task",
        refId: String(task._id),
      });
    }

    return NextResponse.json({ success: true, data: tasks[0], count: tasks.length, tasks });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 400 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json();
    await connectToDatabase();
    
    const { id, _id, ...updates } = body;
    const targetId = id || _id;
    if (!targetId) {
      return NextResponse.json({ success: false, error: "Task ID is required" }, { status: 400 });
    }
    
    if (updates.status === "Completed") {
      if (!updates.completedAt) {
        updates.completedAt = new Date();
      }
    }
    
    // Given to someone else → their id goes with it (the old id would keep
    // showing the task to the previous person).
    if (updates.assignedStaff !== undefined && updates.assignedStaffId === undefined) {
      const person: any = isGroupAssignee(updates.assignedStaff)
        ? null
        : await User.findOne({ name: exactName(String(updates.assignedStaff)) }, { _id: 1 }).lean();
      updates.assignedStaffId = person ? String(person._id) : "";
    }
    const before: any = await StaffTask.findById(targetId).lean();
    const updated: any = await StaffTask.findByIdAndUpdate(targetId, { $set: updates }, { new: true }).lean();
    if (!updated) {
      return NextResponse.json({ success: false, error: "Task not found" }, { status: 404 });
    }

    // Given to someone new → they get it as a new task. Its target or deadline
    // changed → the same person is told. A plain status update by the staff
    // themselves (In Progress / Completed) sends nothing.
    const actor = await getActor().catch(() => null);
    const reassigned = before && String(before.assignedStaff || "") !== String(updated.assignedStaff || "");
    const changed =
      before &&
      ["taskTitle", "dueDate", "dueTime", "targetQty", "targetAmount", "targetProduct", "targetBrand", "priority", "description"].some(
        (k) => String(before[k] ?? "") !== String(updated[k] ?? "")
      );
    if (reassigned) {
      await notifyAssignee(updated.assignedStaff, updated.assignedStaffId, {
        ...describeTask(updated),
        link: "/staff/tasks",
        createdBy: actor?.name || "",
      });
    } else if (changed) {
      const d = describeTask(updated);
      await notifyAssignee(updated.assignedStaff, updated.assignedStaffId, {
        type: "task_updated",
        title: `✏️ Updated: ${updated.taskTitle}`,
        message: d.message,
        link: "/staff/tasks",
        createdBy: actor?.name || "",
      });
    }
    
    return NextResponse.json({ success: true, data: updated });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ success: false, error: "Task ID is required" }, { status: 400 });
    }
    await connectToDatabase();
    await StaffTask.findByIdAndDelete(id);
    return NextResponse.json({ success: true, message: "Task deleted successfully" });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
