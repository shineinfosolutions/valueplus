import User from "@/models/User";
import Notification, { INotification } from "@/models/Notification";

/**
 * Send a notification to the bell of one or more users. Best-effort: a failure
 * here is logged and never fails the action that triggered it.
 */

export interface NotifyInput {
  type: INotification["type"];
  title: string;
  message?: string;
  link?: string;
  createdBy?: string;
}

type Recipient = { _id: any; name?: string };

async function send(recipients: Recipient[], input: NotifyInput): Promise<number> {
  const unique = new Map<string, Recipient>();
  for (const r of recipients) if (r?._id) unique.set(String(r._id), r);
  if (unique.size === 0) return 0;
  await Notification.insertMany(
    Array.from(unique.values()).map((r) => ({
      recipientId: String(r._id),
      recipientName: r.name || "",
      type: input.type,
      title: input.title,
      message: input.message || "",
      link: input.link || "",
      createdBy: input.createdBy || "",
    }))
  );
  return unique.size;
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const ACTIVE = { $or: [{ status: "active" }, { status: { $exists: false } }] };

/** Users addressed by a task's "Assign To": a person's name, "All Staff" or "Sales Staff". */
export async function usersForAssignee(assignee: string, assigneeId?: string): Promise<Recipient[]> {
  const name = String(assignee || "").trim();
  if (assigneeId) {
    const byId = await User.find({ _id: assigneeId }, { name: 1 }).lean().catch(() => []);
    if ((byId as any[]).length) return byId as any[];
  }
  if (!name || /^admin \(self\)$/i.test(name)) return [];
  if (/^all staff$/i.test(name)) {
    return (await User.find({ ...ACTIVE, role: { $nin: ["admin", "superadmin"] } }, { name: 1 }).lean()) as any[];
  }
  if (/^sales staff$/i.test(name)) {
    return (await User.find({ ...ACTIVE, role: { $in: ["salesman", "sales"] } }, { name: 1 }).lean()) as any[];
  }
  return (await User.find({ name: { $regex: new RegExp(`^${escapeRegex(name)}$`, "i") } }, { name: 1 }).lean()) as any[];
}

export async function notifyAssignee(assignee: string, assigneeId: string | undefined, input: NotifyInput) {
  try {
    return await send(await usersForAssignee(assignee, assigneeId), input);
  } catch (e) {
    console.warn("Notice: could not send notification:", e);
    return 0;
  }
}

/** Every active admin (the approvers). */
export async function notifyAdmins(input: NotifyInput) {
  try {
    const admins = (await User.find({ ...ACTIVE, role: { $in: ["admin", "superadmin"] } }, { name: 1 }).lean()) as any[];
    return await send(admins, input);
  } catch (e) {
    console.warn("Notice: could not notify admins:", e);
    return 0;
  }
}

/** One user, found by email. */
export async function notifyEmail(email: string, input: NotifyInput) {
  try {
    const e = String(email || "").trim();
    if (!e) return 0;
    const users = (await User.find({ email: { $regex: new RegExp(`^${escapeRegex(e)}$`, "i") } }, { name: 1 }).lean()) as any[];
    return await send(users, input);
  } catch (err) {
    console.warn("Notice: could not send notification:", err);
    return 0;
  }
}
