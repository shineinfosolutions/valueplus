import { redirect } from "next/navigation";

/** "Take Out of Store" is now part of the Out for Delivery screen. */
export default function StoreExitPage() {
  redirect("/sales/dispatch");
}
