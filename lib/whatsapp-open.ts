/**
 * Opens a WhatsApp chat with the message already typed, from a button click.
 *
 * - Phone: https://api.whatsapp.com/send, which the phone opens in the WhatsApp app.
 * - Computer: the WhatsApp desktop app first (whatsapp://send), and if the app is not there to take the link,
 *   WhatsApp Web (web.whatsapp.com) instead.
 *
 * A browser cannot ask whether the desktop app is installed. So the link to the app is tried first, and if this
 * page does not lose focus within a couple of seconds (an app opening takes the focus), WhatsApp Web opens.
 * The first time, the browser asks "Open WhatsApp?": tick "Always allow" so it opens straight away afterwards.
 *
 * `phone` is the customer's number (a 10-digit Indian mobile number gets the 91 added); without one the chat
 * list opens and the user picks the person.
 */
export function openWhatsApp(phone: string | undefined | null, text: string): void {
  if (typeof window === "undefined") return;
  const digits = String(phone || "").replace(/\D/g, "").slice(-10);
  const to = digits.length === 10 ? `91${digits}` : "";
  const query = `${to ? `phone=${to}&` : ""}text=${encodeURIComponent(text)}`;

  if (/android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent)) {
    window.open(`https://api.whatsapp.com/send?${query}`, "_blank");
    return;
  }

  let focusLeft = false;
  const onLeave = () => {
    focusLeft = true;
  };
  window.addEventListener("blur", onLeave);
  document.addEventListener("visibilitychange", onLeave);

  const link = document.createElement("a");
  link.href = `whatsapp://send?${query}`;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();

  window.setTimeout(() => {
    window.removeEventListener("blur", onLeave);
    document.removeEventListener("visibilitychange", onLeave);
    if (!focusLeft) window.open(`https://web.whatsapp.com/send?${query}`, "_blank");
  }, 2200);
}
