"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Coffee } from "lucide-react";
import { Button } from "@/components/ui/button";

const todayIst = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

const getFix = () =>
  new Promise<{ lat: number; lng: number; accuracy: number }>((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("This device cannot share its location."));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      () => reject(new Error("Could not get your location. Allow location and turn on GPS.")),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  });

/**
 * The Break button. It only exists once the Store Manager has approved a break for today: then "Start break" appears.
 * While it runs the person can be anywhere; when the time is up the app tries to confirm they are back at the store,
 * and "I am back" does it by hand. If it is not confirmed, the Store Manager and Admin are alerted by the server.
 */
export function BreakControl() {
  const queryClient = useQueryClient();
  const [now, setNow] = useState(Date.now());
  const autoTried = useRef<string>("");

  const { data: breaks = [] } = useQuery({
    queryKey: ["my-break"],
    refetchInterval: 15000,
    queryFn: async () => {
      const json = await (await fetch("/api/staff/leave-requests?mine=1&status=approved")).json();
      return ((json.data || []) as any[]).filter((r) => r.kind === "break" && r.fromDate === todayIst() && !r.breakReturnedAt);
    },
  });
  const brk: any = breaks[0];

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const act = useMutation({
    mutationFn: async (action: "start" | "return") => {
      const fix = action === "return" ? await getFix() : {};
      const json = await (await fetch("/api/staff/break", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: brk._id, action, ...fix }) })).json();
      if (!json.success) throw new Error(json.error || "Could not save");
      return json;
    },
    onSuccess: (d) => {
      toast.success(d.message);
      queryClient.invalidateQueries({ queryKey: ["my-break"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const endsAt = brk?.breakEndsAt ? new Date(brk.breakEndsAt).getTime() : 0;
  const running = !!brk?.breakStartedAt && endsAt > now;
  const over = !!brk?.breakStartedAt && endsAt <= now;

  // When the time is up, quietly try to confirm the person is back at the store.
  useEffect(() => {
    if (!over || !brk || autoTried.current === brk._id) return;
    autoTried.current = brk._id;
    getFix()
      .then((fix) => fetch("/api/staff/break", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: brk._id, action: "return", ...fix }) }))
      .then((r) => r.json())
      .then((j) => { if (j.success) queryClient.invalidateQueries({ queryKey: ["my-break"] }); })
      .catch(() => {});
  }, [over, brk, queryClient]);

  if (!brk) return null;
  const left = Math.max(0, Math.round((endsAt - now) / 1000));
  const mm = String(Math.floor(left / 60)).padStart(2, "0");
  const ss = String(left % 60).padStart(2, "0");

  if (!brk.breakStartedAt) {
    return (
      <Button onClick={() => act.mutate("start")} disabled={act.isPending} className="col-span-2 md:col-span-1 h-11 md:h-10 px-3 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-sm rounded-xl gap-1.5">
        <Coffee className="w-4 h-4" /> Start {brk.breakMinutes} min break
      </Button>
    );
  }
  if (running) {
    return (
      <div className="col-span-2 md:col-span-1 flex h-11 md:h-10 items-center justify-center gap-1.5 rounded-xl bg-amber-500/20 px-3 text-sm font-bold text-amber-200 border border-amber-400/40">
        <Coffee className="w-4 h-4" /> Break {mm}:{ss} left
      </div>
    );
  }
  return (
    <Button onClick={() => act.mutate("return")} disabled={act.isPending} className="col-span-2 md:col-span-1 h-11 md:h-10 px-3 bg-rose-500 hover:bg-rose-600 text-white font-bold text-sm rounded-xl gap-1.5">
      <Coffee className="w-4 h-4" /> {act.isPending ? "Checking location..." : "Break over - I am back"}
    </Button>
  );
}
