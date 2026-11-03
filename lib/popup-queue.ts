"use client";

import { useEffect, useState } from "react";

/**
 * Only one pop-up at a time. Several screens can want to show a pop-up at once (bills waiting, a leave request, a
 * discount to approve, unread notifications...); stacked on a phone they cover everything. A pop-up asks here: the first
 * to ask is shown, the others wait their turn and come up one after another as each is closed.
 */
const queue: string[] = [];
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export function useExclusivePopup(id: string, wanted: boolean): boolean {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  useEffect(() => {
    const at = queue.indexOf(id);
    if (wanted && at === -1) {
      queue.push(id);
      notify();
    } else if (!wanted && at !== -1) {
      queue.splice(at, 1);
      notify();
    }
    return () => {
      const i = queue.indexOf(id);
      if (i !== -1) {
        queue.splice(i, 1);
        notify();
      }
    };
  }, [wanted, id]);
  return wanted && queue[0] === id;
}
