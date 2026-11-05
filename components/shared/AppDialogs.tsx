"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * The app's own "Are you sure?" and "Type a reason" boxes.
 *
 * The browser's window.confirm / window.prompt do not show inside the Android app (WebView) or the Claude desktop
 * browser: they return "Cancel" at once, so a Delete button that asked confirm() silently did nothing. Use these
 * instead:
 *
 *   if (!(await appConfirm("Delete this unit?"))) return;
 *   const reason = await appPrompt("Reason for rejecting (optional):");  // null = cancelled
 *
 * <AppDialogHost /> is mounted once in the root layout.
 */
type Request =
  | { kind: "confirm"; message: string; danger: boolean; resolve: (v: boolean) => void }
  | { kind: "prompt"; message: string; value: string; resolve: (v: string | null) => void };

let push: ((r: Request) => void) | null = null;

export function appConfirm(message: string, opts: { danger?: boolean } = {}): Promise<boolean> {
  return new Promise((resolve) => {
    if (!push) return resolve(typeof window !== "undefined" ? window.confirm(message) : false);
    push({ kind: "confirm", message, danger: opts.danger ?? /delete|remove|cancel|undo/i.test(message), resolve });
  });
}

export function appPrompt(message: string, defaultValue = ""): Promise<string | null> {
  return new Promise((resolve) => {
    if (!push) return resolve(typeof window !== "undefined" ? window.prompt(message, defaultValue) : null);
    push({ kind: "prompt", message, value: defaultValue, resolve });
  });
}

export function AppDialogHost() {
  const [queue, setQueue] = useState<Request[]>([]);
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const current = queue[0];

  useEffect(() => {
    push = (r) => setQueue((q) => [...q, r]);
    return () => {
      push = null;
    };
  }, []);

  useEffect(() => {
    if (current?.kind === "prompt") {
      setText(current.value);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [current]);

  const finish = (ok: boolean) => {
    if (!current) return;
    if (current.kind === "confirm") current.resolve(ok);
    else current.resolve(ok ? text : null);
    setQueue((q) => q.slice(1));
  };

  return (
    <Dialog open={!!current} onOpenChange={(o) => { if (!o) finish(false); }}>
      <DialogContent className="max-w-md z-[200]">
        <DialogHeader>
          <DialogTitle>{current?.kind === "prompt" ? "Please enter" : "Please confirm"}</DialogTitle>
          <DialogDescription className="text-sm text-slate-700 whitespace-pre-line">{current?.message}</DialogDescription>
        </DialogHeader>
        {current?.kind === "prompt" && (
          <Input
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") finish(true);
            }}
          />
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => finish(false)}>Cancel</Button>
          <Button
            onClick={() => finish(true)}
            className={current?.kind === "confirm" && current.danger ? "bg-red-600 hover:bg-red-700 text-white" : "bg-[#30539C] hover:bg-[#25427d] text-white"}
          >
            {current?.kind === "prompt" ? "OK" : current?.danger ? "Yes, continue" : "Yes"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
