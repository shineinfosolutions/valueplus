/**
 * Sharing a lead with another salesman.
 *
 * A lead belongs to one salesman (assignedStaff). When the customer also wants a product of another brand — say the
 * LLOYD salesman's customer wants an LG AC — the owner sends a share request to that brand's salesman. Once he
 * accepts, the lead shows in his list too and both can follow it up. On the bill, each product line goes to the
 * salesman of its brand among the lead's people, and so does that line's incentive.
 *
 * Kept free of imports so the API, the billing form and the screens share it.
 */

export const normPerson = (n: any) => String(n || "").replace(/\(.*?\)/g, "").replace(/\s+/g, " ").trim().toLowerCase();
export const normBrandName = (b: any) => String(b || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Does a product brand match a salesman's brand ("LG" vs "LG Electronics")? */
export function brandMatches(staffBrand: any, productBrand: any): boolean {
  const a = normBrandName(staffBrand);
  const b = normBrandName(productBrand);
  return !!a && !!b && (a === b || b.split(" ").includes(a) || a.split(" ").includes(b));
}

/** A salesman's brands: assignedBrands, falling back to the single assignedBrand. */
export function brandsOf(user: any): string[] {
  const list = Array.isArray(user?.assignedBrands) ? user.assignedBrands.filter(Boolean) : [];
  return list.length ? list : user?.assignedBrand ? [user.assignedBrand] : [];
}

export const acceptedShares = (lead: any): any[] =>
  (Array.isArray(lead?.sharedWith) ? lead.sharedWith : []).filter((s: any) => s.status === "accepted");

export const pendingShares = (lead: any): any[] =>
  (Array.isArray(lead?.sharedWith) ? lead.sharedWith : []).filter((s: any) => s.status === "pending");

/**
 * The salesman a bill line goes to: among the lead's owner and accepted shares, the one whose brand matches the
 * product's brand; otherwise "" (the line stays with the bill's Sales Executive).
 * `users` are the staff records (name, assignedBrand(s)) used to know each person's brand.
 */
export function lineSalesmanFor(lead: any, productBrand: any, users: any[]): string {
  if (!lead || !productBrand) return "";
  const people: { name: string; brand?: string }[] = [
    { name: String(lead.assignedStaff || "") },
    ...acceptedShares(lead).map((s: any) => ({ name: String(s.staff || ""), brand: s.brand })),
  ].filter((p) => p.name && !/^sales team$/i.test(p.name));
  for (const p of people) {
    const user = users.find((u) => normPerson(u.name) === normPerson(p.name));
    const brands = [...(p.brand ? [p.brand] : []), ...brandsOf(user)];
    if (brands.some((b) => brandMatches(b, productBrand))) return user?.name || p.name;
  }
  return "";
}
