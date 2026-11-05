/**
 * What happened on a lead follow-up call, picked in one tap when the follow-up is recorded. Kept free of imports so
 * the API, the leads page and the dashboards share it.
 */
export interface FollowUpOutcome {
  key: string;
  label: string;
  emoji: string;
  /** Tailwind classes for the chip. */
  tone: string;
}

export const FOLLOW_UP_OUTCOMES: FollowUpOutcome[] = [
  { key: "not_received", label: "Call not received", emoji: "📵", tone: "bg-rose-50 text-rose-700 border-rose-200" },
  { key: "switched_off", label: "Switched off / not reachable", emoji: "📴", tone: "bg-rose-50 text-rose-700 border-rose-200" },
  { key: "call_back", label: "Asked to call back", emoji: "🔁", tone: "bg-amber-50 text-amber-800 border-amber-200" },
  { key: "interested", label: "Interested", emoji: "👍", tone: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  { key: "will_visit", label: "Will visit store", emoji: "🏬", tone: "bg-blue-50 text-blue-700 border-blue-200" },
  { key: "price_issue", label: "Price too high", emoji: "💸", tone: "bg-purple-50 text-purple-700 border-purple-200" },
  { key: "bought_elsewhere", label: "Bought elsewhere", emoji: "🛒", tone: "bg-slate-100 text-slate-700 border-slate-300" },
  { key: "not_interested", label: "Not interested", emoji: "❌", tone: "bg-slate-100 text-slate-700 border-slate-300" },
  { key: "purchased", label: "Purchased", emoji: "✅", tone: "bg-emerald-100 text-emerald-800 border-emerald-300" },
];

export const outcomeOf = (key: any): FollowUpOutcome | undefined => FOLLOW_UP_OUTCOMES.find((o) => o.key === key);

/** The newest follow-up on a lead (by when it was logged), or undefined. */
export function lastFollowUp(lead: any): any | undefined {
  const list: any[] = Array.isArray(lead?.followUps) ? lead.followUps : [];
  return list.length ? list[list.length - 1] : undefined;
}

/** One follow-up in words: "📵 Call not received · “will call Sunday”". */
export function followUpText(f: any): string {
  if (!f) return "";
  const o = outcomeOf(f.outcome);
  return [o ? `${o.emoji} ${o.label}` : "", f.notes ? `“${f.notes}”` : ""].filter(Boolean).join(" · ");
}
