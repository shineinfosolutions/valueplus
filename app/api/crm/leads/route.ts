import { outcomeOf } from "@/lib/lead-outcomes";
import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import Lead from "@/models/Lead";
import { notifyWhatsApp } from "@/lib/whatsapp/notify";
import { getActor } from "@/lib/requirePermission";
import { notifyAssignee } from "@/lib/notify";
import User from "@/models/User";
import { brandsOf, normPerson } from "@/lib/lead-share";

/** Roles that see every lead; everyone else sees only their own. */
const ALL_LEADS_ROLES = ["admin", "superadmin", "manager", "accounts", "cashier"];
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");
    const staff = searchParams.get("staff");
    const priority = searchParams.get("priority");
    const mobile = searchParams.get("mobile");
    
    await connectToDatabase();

    const actor = await getActor();
    if (!actor) {
      return NextResponse.json({ success: false, error: "You must be signed in to see leads." }, { status: 401 });
    }

    // The salesmen a lead can be shared with: name and brand(s).
    if (searchParams.get("shareTargets") === "1") {
      const users: any[] = await User.find(
        { role: { $in: ["salesman", "sales"] }, status: { $ne: "inactive" } },
        { name: 1, assignedBrand: 1, assignedBrands: 1 }
      ).sort({ name: 1 }).lean();
      return NextResponse.json({
        success: true,
        data: users.map((u) => ({ id: String(u._id), name: u.name, brands: brandsOf(u) })),
      });
    }
    // Share requests waiting for this person to accept or reject.
    if (searchParams.get("shareInbox") === "1") {
      const inbox = await Lead.find({ sharedWith: { $elemMatch: { staffId: actor.id, status: "pending" } } }).sort({ updatedAt: -1 }).lean();
      return NextResponse.json({ success: true, data: inbox });
    }

    const filter: any = {};
    // A salesperson sees only the leads assigned to them (and the unassigned
    // "Sales Team" pool); Admin, Store Manager and Accounts see every lead.
    // Looking a lead up by the customer's mobile (the billing form does, to put
    // the lead's salesperson on the bill) works for anyone signed in.
    if (!ALL_LEADS_ROLES.includes(actor.role) && !mobile) {
      const isSales = ["salesman", "sales"].includes(actor.role);
      // "Amit Singh (Sales Executive)" also matches leads assigned to "Amit Singh".
      const names = [...new Set([actor.name.trim(), actor.name.replace(/\s*\(.*\)\s*$/, "").trim()])].filter(Boolean);
      filter.$or = [
        ...names.map((n) => ({ assignedStaff: { $regex: new RegExp(`^\\s*${escapeRegex(n)}\\s*$`, "i") } })),
        ...(isSales ? [{ assignedStaff: { $regex: /^sales team$/i } }, { assignedStaff: { $in: ["", null] } }] : []),
        // A lead another salesman shared with them, once they accepted it.
        { sharedWith: { $elemMatch: { staffId: actor.id, status: "accepted" } } },
      ];
    }
    if (status && status !== "all") filter.status = status;
    if (staff) filter.assignedStaff = staff;
    if (priority) filter.priority = priority;
    // Matched on the last 10 digits so "+91 98765 43210" and "9876543210" are the
    // same customer — the billing form looks a lead up by the typed mobile number.
    if (mobile) {
      const digits = mobile.replace(/\D/g, "").slice(-10);
      filter.mobile = digits.length === 10 ? { $regex: `${digits}$` } : mobile;
    }
    
    const leads = await Lead.find(filter).sort({ createdAt: -1 });
    return NextResponse.json({ success: true, data: leads });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    await connectToDatabase();
    for (const k of ["calls", "callCount", "lastCalledAt", "followUps", "lastFollowUpDate"]) delete body[k];
    // A salesman can only make a lead for himself, whatever the form says.
    const creator = await getActor();
    if (creator && ["salesman", "sales"].includes(creator.role)) body.assignedStaff = creator.name;

    if (!body.leadId) {
      const count = await Lead.countDocuments();
      body.leadId = `LEAD-2026-${String(count + 1).padStart(4, "0")}`;
    }
    
    if (!body.timeline) {
      body.timeline = [
        {
          date: new Date(),
          action: "Lead Created",
          notes: body.notes || "New sales enquiry registered",
          staff: body.assignedStaff || "Sales Team",
        },
      ];
    }
    
    const lead = await Lead.create(body);

    const actor = await getActor();
    // The salesman a lead is given to hears about it (bell + phone), unless he made it himself.
    const assigned = String(body.assignedStaff || "").trim();
    if (assigned && !/^sales team$/i.test(assigned) && assigned.toLowerCase() !== String(actor?.name || "").toLowerCase()) {
      await notifyAssignee(assigned, undefined, {
        type: "general",
        title: "New lead for you",
        message: `${lead.customerName} · ${lead.interestedProduct || "enquiry"} · ${lead.mobile}`,
        link: "/marketing/leads",
        createdBy: actor?.name || "",
      });
    }
    await notifyWhatsApp({
      event: "lead.created",
      entity: lead.toObject(),
      actor: actor?.name || body.assignedStaff || "Sales Team",
    });

    return NextResponse.json({ success: true, data: lead });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 400 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json();
    await connectToDatabase();
    
    const { id, leadId, actionNote, followUp, logCall, shareRequest, shareRespond, ...updates } = body;
    // Call and follow-up history is written only by the Call / Follow-up actions
    // (attributed to the signed-in user); it can never be set or edited here.
    for (const k of ["calls", "callCount", "lastCalledAt", "followUps", "lastFollowUpDate", "timeline", "sharedWith", "_id", "createdAt", "updatedAt"]) {
      delete (updates as any)[k];
    }
    const identifier = id ? { _id: id } : { leadId };

    // The Call button: one more call to this customer, by whoever pressed it.
    if (logCall) {
      const actor = await getActor();
      if (!actor) return NextResponse.json({ success: false, error: "Sign in to log calls." }, { status: 401 });
      const staff = actor.name || "Staff";
      const staffId = actor?.id || "";
      const now = new Date();
      const lead: any = await Lead.findOneAndUpdate(
        identifier,
        {
          $inc: { callCount: 1 },
          $set: { lastCalledAt: now },
          $push: {
            calls: { at: now, staff, staffId },
            timeline: { date: now, action: "Called customer", notes: "", staff },
          },
        },
        { new: true, projection: { callCount: 1, lastCalledAt: 1, leadId: 1 } }
      );
      if (!lead) return NextResponse.json({ success: false, error: "Lead not found" }, { status: 404 });
      return NextResponse.json({ success: true, data: lead });
    }
    
    // Share the lead with another salesman (another brand's product). He sees it once he accepts.
    if (shareRequest) {
      const actor = await getActor();
      if (!actor) return NextResponse.json({ success: false, error: "You must be signed in to do this." }, { status: 401 });
      const lead: any = await Lead.findOne(identifier);
      if (!lead) return NextResponse.json({ success: false, error: "Lead not found" }, { status: 404 });
      const isOwner = normPerson(lead.assignedStaff) === normPerson(actor.name);
      const isSharer = (lead.sharedWith || []).some((x: any) => x.staffId === actor.id && x.status === "accepted");
      if (!ALL_LEADS_ROLES.includes(actor.role) && !isOwner && !isSharer) {
        return NextResponse.json({ success: false, error: "Only the lead's salesman can share it." }, { status: 403 });
      }
      const target: any = await User.findById(String(shareRequest.toStaffId || "")).catch(() => null);
      if (!target || !["salesman", "sales"].includes(String(target.role || "").toLowerCase())) {
        return NextResponse.json({ success: false, error: "Choose the salesman to share this lead with." }, { status: 400 });
      }
      if (normPerson(target.name) === normPerson(lead.assignedStaff)) {
        return NextResponse.json({ success: false, error: "This lead already belongs to that salesman." }, { status: 400 });
      }
      const open = (lead.sharedWith || []).find((x: any) => x.staffId === String(target._id) && x.status !== "rejected");
      if (open) {
        return NextResponse.json(
          { success: false, error: open.status === "pending" ? `${target.name} has not answered the earlier request yet.` : `Already shared with ${target.name}.` },
          { status: 409 }
        );
      }
      const products = String(shareRequest.products || "").trim().slice(0, 200);
      if (!products) return NextResponse.json({ success: false, error: "Write which product the customer wants from this salesman." }, { status: 400 });
      const note = String(shareRequest.note || "").trim().slice(0, 300);
      const brand = brandsOf(target)[0] || "";
      lead.sharedWith.push({
        staff: target.name,
        staffId: String(target._id),
        brand,
        products,
        note,
        status: "pending",
        requestedBy: actor.name,
        requestedById: actor.id,
        requestedAt: new Date(),
      });
      lead.timeline.push({ date: new Date(), action: `Share requested with ${target.name}${brand ? ` (${brand})` : ""}`, notes: [products, note].filter(Boolean).join(" · "), staff: actor.name });
      await lead.save();
      await notifyAssignee(target.name, String(target._id), {
        type: "approval_request",
        title: `Lead shared with you: ${lead.customerName}`,
        message: `${actor.name} wants you on ${lead.customerName}'s lead for ${products}. Accept it to see the lead.`,
        link: "/marketing/leads",
        createdBy: actor.name,
      });
      return NextResponse.json({ success: true, message: `Request sent to ${target.name}.`, data: lead });
    }

    // The salesman a lead was shared with accepts or rejects it.
    if (shareRespond) {
      const actor = await getActor();
      if (!actor) return NextResponse.json({ success: false, error: "You must be signed in to do this." }, { status: 401 });
      const decision = shareRespond.decision === "accept" ? "accepted" : shareRespond.decision === "reject" ? "rejected" : "";
      if (!decision) return NextResponse.json({ success: false, error: "Choose accept or reject." }, { status: 400 });
      const lead: any = await Lead.findOne(identifier);
      if (!lead) return NextResponse.json({ success: false, error: "Lead not found" }, { status: 404 });
      const entry = (lead.sharedWith || []).find((x: any) => x.staffId === actor.id && x.status === "pending");
      if (!entry) return NextResponse.json({ success: false, error: "There is no share request for you on this lead." }, { status: 404 });
      entry.status = decision;
      entry.respondedAt = new Date();
      lead.timeline.push({ date: new Date(), action: `${actor.name} ${decision} the shared lead`, notes: entry.products || "", staff: actor.name });
      await lead.save();
      await notifyAssignee(entry.requestedBy || lead.assignedStaff, entry.requestedById || undefined, {
        type: "approval_result",
        title: `Lead share ${decision}: ${lead.customerName}`,
        message: `${actor.name} ${decision} ${lead.customerName}'s lead (${entry.products}).`,
        link: "/marketing/leads",
        createdBy: actor.name,
      });
      return NextResponse.json({ success: true, message: decision === "accepted" ? "Lead added to your list." : "Request rejected.", data: lead });
    }

    // Logging a follow-up: records when the customer was contacted and when the
    // next contact is due, and keeps the history of every one.
    if (followUp) {
      const date = String(followUp.date || "").slice(0, 10);
      const nextDate = String(followUp.nextDate || "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return NextResponse.json({ success: false, error: "The follow-up date is required." }, { status: 400 });
      }
      if (nextDate && nextDate < date) {
        return NextResponse.json(
          { success: false, error: "The next follow-up date cannot be before the follow-up date." },
          { status: 400 }
        );
      }
      const actor = await getActor();
      // Always the signed-in user — never taken from the form.
      const staff = actor?.name || "Staff";
      const staffId = actor?.id || "";
      const notes = String(followUp.notes || "").trim().slice(0, 500);
      const outcome = outcomeOf(followUp.outcome) ? String(followUp.outcome) : "";
      if (!outcome && !notes) {
        return NextResponse.json(
          { success: false, error: "Choose what happened on the call, or write what the customer said." },
          { status: 400 }
        );
      }
      const outcomeLabel = outcomeOf(outcome)?.label || "";

      const lead: any = await Lead.findOne(identifier);
      if (!lead) {
        return NextResponse.json({ success: false, error: "Lead not found" }, { status: 404 });
      }
      lead.lastFollowUpDate = date;
      lead.followUpDate = nextDate;
      lead.followUps.push({ date, nextDate, outcome, notes, staff, staffId, loggedAt: new Date() });
      lead.timeline.push({
        date: new Date(),
        action: `${nextDate ? `Follow-up done on ${date}, next on ${nextDate}` : `Follow-up done on ${date}`}${outcomeLabel ? ` (${outcomeLabel})` : ""}`,
        notes,
        staff,
      });
      // A lead that has been spoken to and has another call due is in follow-up;
      // one already won or lost keeps its outcome.
      if (nextDate && !["Converted", "Lost"].includes(lead.status)) lead.status = "Follow-up";
      await lead.save();
      return NextResponse.json({ success: true, data: lead });
    }

    const updateObj: any = { ...updates };
    if (actionNote) {
      updateObj.$push = {
        timeline: {
          date: new Date(),
          action: updates.status ? `Status changed to ${updates.status}` : "Lead Note Added",
          notes: actionNote,
          staff: updates.assignedStaff || "Staff",
        },
      };
    }
    
    // The old status has to be read before the update, or the "changed from"
    // half of the message would just repeat the new value.
    const before: any = await Lead.findOne(identifier).lean();

    const updated = await Lead.findOneAndUpdate(identifier, updateObj, { new: true });
    if (!updated) {
      return NextResponse.json({ success: false, error: "Lead not found" }, { status: 404 });
    }

    if (updates.status && before?.status && updates.status !== before.status) {
      const actor = await getActor();
      await notifyWhatsApp({
        event: "lead.status",
        entity: updated.toObject(),
        previousStatus: before.status,
        actor: actor?.name || updates.assignedStaff || "Staff",
      });
    }

    return NextResponse.json({ success: true, data: updated });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
