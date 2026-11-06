"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/**
 * Scan the barcode on a product's serial-number sticker with the device camera. The camera stays open until a code
 * is read; then a still photo of that moment (the sticker with the barcode) is handed back with the code, so the
 * scan itself is the serial-number photo.
 *
 * Uses ZXing (works in every browser, unlike the built-in BarcodeDetector). The library is loaded only when the
 * scanner is opened.
 */
export function BarcodeScanner({
  open,
  onClose,
  onScan,
  title = "Scan the serial number barcode",
}: {
  open: boolean;
  onClose: () => void;
  /** `code` is the text of the barcode; `photo` is a JPEG of the camera view when it was read. */
  onScan: (code: string, photo: File) => void;
  title?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  // The latest callbacks, so the camera is not restarted when the parent re-renders.
  const onScanRef = useRef(onScan);
  const onCloseRef = useRef(onClose);
  onScanRef.current = onScan;
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    let stopped = false;
    let controls: { stop: () => void } | null = null;
    setError("");
    setReady(false);

    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser cannot open the camera.");
        const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
          import("@zxing/browser"),
          import("@zxing/library"),
        ]);
        if (stopped || !videoRef.current) return;
        const hints = new Map();
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [
          BarcodeFormat.CODE_128,
          BarcodeFormat.CODE_39,
          BarcodeFormat.CODE_93,
          BarcodeFormat.EAN_13,
          BarcodeFormat.EAN_8,
          BarcodeFormat.UPC_A,
          BarcodeFormat.ITF,
          BarcodeFormat.CODABAR,
          BarcodeFormat.QR_CODE,
          BarcodeFormat.DATA_MATRIX,
        ]);
        hints.set(DecodeHintType.TRY_HARDER, true);
        const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 120 });
        controls = await reader.decodeFromConstraints(
          { video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } }, audio: false },
          videoRef.current,
          (result) => {
            if (!result || stopped) return;
            const v = videoRef.current;
            if (!v || !v.videoWidth) return;
            stopped = true;
            const code = String(result.getText() || "").trim();
            const canvas = document.createElement("canvas");
            const scale = Math.min(1, 1280 / v.videoWidth);
            canvas.width = Math.round(v.videoWidth * scale);
            canvas.height = Math.round(v.videoHeight * scale);
            canvas.getContext("2d")?.drawImage(v, 0, 0, canvas.width, canvas.height);
            canvas.toBlob(
              (blob) => {
                controls?.stop();
                if (!blob || !code) {
                  onCloseRef.current();
                  return;
                }
                // Named like the in-app camera's photos, which is what the server accepts from delivery staff.
                onScanRef.current(code, new File([blob], `photo-${Date.now()}.jpg`, { type: "image/jpeg" }));
                onCloseRef.current();
              },
              "image/jpeg",
              0.85
            );
          }
        );
        if (stopped) controls.stop();
        else setReady(true);
      } catch (e: any) {
        setError(e?.name === "NotAllowedError" ? "Camera permission is blocked. Allow the camera for this site and try again." : e?.message || "Could not open the camera.");
      }
    })();

    return () => {
      stopped = true;
      controls?.stop();
    };
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Hold the camera steady over the barcode on the serial number sticker. It is read by itself.</DialogDescription>
        </DialogHeader>
        {error ? (
          <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">{error}</p>
        ) : (
          <div className="relative">
            <video ref={videoRef} playsInline muted className="w-full rounded-xl bg-black" />
            <div className="pointer-events-none absolute inset-x-6 top-1/2 h-0.5 -translate-y-1/2 bg-rose-500/80" />
            {!ready && <p className="absolute inset-0 flex items-center justify-center text-xs font-semibold text-white">Opening the camera...</p>}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
