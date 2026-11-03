"use client";

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CameraCapture } from "@/components/shared/CameraCapture";
import { MAX_GPS_ERROR_M, STORE, STORE_RADIUS_M, distanceM } from "@/lib/store-location";

type Fix = { lat: number; lng: number; accuracy: number };

/**
 * Check-in: the phone's location must be inside the store (100 m) and a selfie is taken, then both go to the server,
 * which checks the location again. The Admin and Store Manager see the photo on the staff dashboard.
 */
export function AttendanceCheckInDialog({ open, onClose, branchName }: { open: boolean; onClose: () => void; branchName?: string }) {
  const queryClient = useQueryClient();
  const [fix, setFix] = useState<Fix | null>(null);
  const [locError, setLocError] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);

  const [denied, setDenied] = useState(false);

  // Asking for the location again each time the dialog opens (and on "Allow location") makes the phone show its
  // permission prompt again whenever it has not been blocked for good.
  const locate = () => {
    setFix(null);
    setLocError("");
    setDenied(false);
    if (!navigator.geolocation) return setLocError("This device cannot share its location.");
    navigator.geolocation.getCurrentPosition(
      (p) => setFix({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (e) => {
        setDenied(e.code === 1);
        setLocError(e.code === 1 ? "Location permission was not given. Tap Allow location, then choose Allow." : "Could not get your location. Turn on GPS and try again.");
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  };

  useEffect(() => {
    if (open) {
      setPhoto(null);
      setPreview("");
      locate();
    }
  }, [open]);

  // While the dialog stays open without permission, ask again every few seconds.
  useEffect(() => {
    if (!open || !denied) return;
    const t = setInterval(locate, 6000);
    return () => clearInterval(t);
  }, [open, denied]);

  // The moment the person allows location (in the prompt or in the phone's site settings), carry on without a tap.
  useEffect(() => {
    if (!open || !("permissions" in navigator)) return;
    let status: PermissionStatus | null = null;
    const onChange = () => { if (status?.state === "granted") locate(); };
    (navigator as any).permissions
      .query({ name: "geolocation" })
      .then((s: PermissionStatus) => { status = s; s.addEventListener("change", onChange); })
      .catch(() => {});
    return () => status?.removeEventListener("change", onChange);
  }, [open]);

  useEffect(() => {
    if (!photo) return setPreview("");
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  const distance = fix ? Math.round(distanceM(fix.lat, fix.lng, STORE.lat, STORE.lng)) : null;
  const vague = !!fix && fix.accuracy > MAX_GPS_ERROR_M;
  const inside = distance !== null && distance <= STORE_RADIUS_M && !vague;

  const save = useMutation({
    mutationFn: async () => {
      if (!photo || !fix) throw new Error("Location and photo are needed.");
      const form = new FormData();
      form.append("file", photo);
      const up = await (await fetch("/api/staff/attendance/photo", { method: "POST", body: form })).json();
      if (!up.success) throw new Error(up.error || "Could not upload the photo.");
      const res = await (
        await fetch("/api/staff/attendance", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "check_in", photoKey: up.data.key, lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy, branchName }),
        })
      ).json();
      if (!res.success) throw new Error(res.error || "Check-in failed");
      return res;
    },
    onSuccess: (d) => {
      toast.success(d.message || "Checked in.");
      queryClient.invalidateQueries({ queryKey: ["my-attendance"] });
      queryClient.invalidateQueries({ queryKey: ["attendance"] });
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Check in</DialogTitle>
          <DialogDescription>You must be inside the store, and a selfie is taken.</DialogDescription>
        </DialogHeader>

        <div className={`rounded-lg border p-3 text-xs ${inside ? "border-emerald-300 bg-emerald-50 text-emerald-900" : locError || fix ? "border-rose-300 bg-rose-50 text-rose-900" : "border-slate-200 bg-slate-50 text-slate-600"}`}>
          {locError ? (
            locError
          ) : !fix ? (
            "Finding your location..."
          ) : vague ? (
            `Your location is not accurate enough (about ${Math.round(fix.accuracy)} m off). Move to an open spot and try again.`
          ) : inside ? (
            `You are inside the store (${distance} m from the spot).`
          ) : (
            `You are about ${distance} m from the store. Go inside the store (within ${STORE_RADIUS_M} m) to check in.`
          )}
          <button type="button" onClick={locate} className="ml-2 font-bold underline">{denied ? "Allow location" : "Check again"}</button>
          {denied && (
            <span className="mt-1 block text-[11px]">
              If no question appears, open the phone's site settings for this app, set Location to Allow, and come back — check-in carries on by itself.
            </span>
          )}
        </div>

        <div className="space-y-2">
          {preview ? <img src={preview} alt="Your selfie" className="mx-auto h-44 rounded-xl object-cover" /> : <p className="text-xs text-slate-500">No photo yet.</p>}
          <Button type="button" variant="outline" size="sm" onClick={() => setCameraOpen(true)}>{photo ? "Retake selfie" : "Take selfie"}</Button>
        </div>
        <CameraCapture open={cameraOpen} onClose={() => setCameraOpen(false)} onCapture={setPhoto} facing="user" title="Take your selfie" />

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!inside || !photo || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Checking in..." : "Check in"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
