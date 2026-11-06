/**
 * Checking a scanned serial-number barcode against the serial numbers recorded on a bill.
 * Used when the delivery boy scans (so a wrong product is refused at once) and again when the photos are saved.
 */

const norm = (s: string) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Every serial number written on the bill's items (a line may hold several, separated by commas, spaces or new lines). */
export function serialsOnBill(items: any[] | undefined | null): string[] {
  return (items || [])
    .flatMap((it: any) => String(it?.serialNumber || "").split(/[,;\n\s]+/))
    .map(norm)
    .filter(Boolean);
}

/**
 * `billHasSerials` is false when the bill records no serial number, so there is nothing to match against.
 * `matched` is true when the scanned code is one of them: the same letters and digits, or (6+ characters) one
 * inside the other, because a sticker barcode sometimes carries a prefix.
 */
export function checkSerialOnBill(scanned: string, items: any[] | undefined | null): { billHasSerials: boolean; matched: boolean } {
  const wanted = norm(scanned);
  const onBill = serialsOnBill(items);
  if (onBill.length === 0) return { billHasSerials: false, matched: false };
  const matched = onBill.some((b) => b === wanted || (b.length >= 6 && wanted.length >= 6 && (wanted.includes(b) || b.includes(wanted))));
  return { billHasSerials: true, matched };
}
