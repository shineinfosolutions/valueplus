"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { MapPinOff } from "lucide-react";
import { AWAY_ALERT_MINUTES } from "@/lib/store-location";
import { awaySummary, minutesSince, timeIst } from "@/lib/away-format";

/**
 * Dashboard card (Admin / Store Manager / HR): who is outside the store right now and since when, from the
 * geofence (lib/presence.ts), plus today's away totals. Updates the moment someone leaves or comes back
 * (live-update socket). Only covers time the person's app was open — see GeofenceWatcher.
 */
export function OutsideNowCard() {
  const { data } = useQuery({
    queryKey: ["presence-today"],
    meta: { live: ["/api/staff/presence", "/api/staff/attendance"] },
    queryFn: async () => {
      const json = await (await fetch("/api/staff/presence")).json();
      return json.success ? json.data : null;
    },
  });
  // Redraw the "since" minutes once a minute (on this screen only; nothing is fetched).
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 60000);
    return () => clearInterval(t);
  }, []);

  const outside: any[] = data?.outsideNow || [];
  const awayToday = (data?.rows || []).filter((r: any) => awaySummary(r));
  const long = outside.some((o) => o.kind === "away" && minutesSince(o.leftAt) >= AWAY_ALERT_MINUTES);

  return (
    <div className={`rounded-2xl border shadow-sm p-3 ${long ? "bg-rose-50 border-rose-300" : outside.length ? "bg-amber-50 border-amber-300" : "bg-white border-slate-200"}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-black text-slate-900 uppercase tracking-wide flex items-center gap-1.5">
          <MapPinOff className="w-4 h-4 text-rose-600" /> Outside the store now ({outside.length})
        </p>
        <Link href="/staff/directory" className="text-[11px] font-bold text-[#30539C] hover:underline shrink-0">Staff</Link>
      </div>
      {outside.length === 0 ? (
        <p className="text-[11px] text-slate-500 mt-1">Everyone checked in is at the store.</p>
      ) : (
        <div className="mt-2 space-y-1.5">
          {outside.map((o) => {
            const mins = minutesSince(o.leftAt);
            return (
              <div key={o.staffName} className="flex items-center justify-between gap-2 bg-white rounded-xl border border-amber-200 px-2.5 py-1.5">
                <div className="min-w-0">
                  <p className="text-xs font-bold text-slate-900 truncate">{String(o.staffName).replace(/\s*\(.*\)\s*$/, "")}</p>
                  <p className="text-xs text-slate-500 truncate">
                    left {timeIst(o.leftAt)}
                    {o.maxDistanceM ? ` · ~${o.maxDistanceM} m` : ""}
                    {o.kind === "break" ? " · on break" : ""}
                  </p>
                </div>
                <span className={`text-xs font-black shrink-0 ${o.kind === "away" && mins >= AWAY_ALERT_MINUTES ? "text-rose-700" : "text-slate-900"}`}>{mins} min</span>
              </div>
            );
          })}
        </div>
      )}
      {awayToday.length > 0 && (
        <p className="text-[11px] text-slate-500 mt-2">
          Today: {awayToday.map((r: any) => `${String(r.staffName).replace(/\s*\(.*\)\s*$/, "")} ${awaySummary(r)}`).join(" · ")}
        </p>
      )}
      <p className="text-[10px] text-slate-400 mt-1">Tracked only while the person's app is open.</p>
    </div>
  );
}
