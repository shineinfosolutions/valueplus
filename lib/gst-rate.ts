/**
 * The GST rates the store bills at. Nothing is billed above 18%: after the
 * 2025 GST changes TVs and ACs moved from 28% to 18%, and products carried
 * over from the old stock sheet at 28% (or at odd rates like 22% and 20.01%)
 * were being billed at that rate.
 */
export const GST_RATES = [0, 5, 12, 18] as const;
export const MAX_GST_RATE = 18;

/** A product's GST rate as it may be billed: one of 0/5/12/18, never above 18. */
export function allowedGstRate(rate: any): number {
  const n = Number(rate);
  if (!Number.isFinite(n) || n < 0) return MAX_GST_RATE;
  if (n >= MAX_GST_RATE) return MAX_GST_RATE;
  return (GST_RATES as readonly number[]).includes(n) ? n : MAX_GST_RATE;
}
