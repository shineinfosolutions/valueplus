/**
 * The store's spot (Kunraghat showroom, from the Google Maps link the Admin gave) and the circle inside which
 * staff can check in. Used by the server (the real check) and by the check-in screen (to tell the person how far they are).
 */
export const STORE = { lat: 26.7464624, lng: 83.4141547 };
export const STORE_RADIUS_M = 100;
/** A phone's location with a worse error than this is too vague to trust. */
export const MAX_GPS_ERROR_M = 150;

export function distanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function checkAtStore(loc: { lat?: any; lng?: any; accuracy?: any }): { ok: boolean; distance: number | null; error?: string } {
  const lat = Number(loc?.lat);
  const lng = Number(loc?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat === 0 || lng === 0 || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return { ok: false, distance: null, error: "Your location is needed. Allow location access and try again." };
  }
  const accuracy = Number(loc?.accuracy);
  if (Number.isFinite(accuracy) && accuracy > MAX_GPS_ERROR_M) {
    return { ok: false, distance: null, error: `Your location is not accurate enough (about ${Math.round(accuracy)} m off). Move to an open spot or turn on GPS and try again.` };
  }
  const distance = Math.round(distanceM(lat, lng, STORE.lat, STORE.lng));
  if (distance > STORE_RADIUS_M) {
    return { ok: false, distance, error: `You are about ${distance} m from the store. You must be inside the store (within ${STORE_RADIUS_M} m).` };
  }
  return { ok: true, distance };
}
