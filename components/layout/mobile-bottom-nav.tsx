"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { useBranch } from "@/context/BranchContext";
import { 
  LayoutDashboard, 
  Receipt, 
  FileText, 
  Warehouse, 
  UserCheck, 
  CreditCard, 
  AlertTriangle, 
  ShoppingBag, 
  Plus, 
  Menu, 
  X, 
  Search, 
  ChevronRight, 
  LogOut, 
  Sparkles, 
  ShieldCheck, 
  Package, 
  ScanBarcode, 
  ArrowRightLeft, 
  Download, 
  Store,
  DollarSign,
  Clock,
  Truck
} from "lucide-react";
import { NAV_GROUPS, UserRole } from "@/constants/navigation";
import { panelForRole } from "@/lib/role-routes";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export function MobileBottomNav() {
  const rawPathname = usePathname();
  const router = useRouter();
  const { data: session, status } = useSession();
  const { activeLocation, locations, setActiveLocation, isGodown } = useBranch();
  
  const [isQuickActionsOpen, setIsQuickActionsOpen] = useState(false);
  const [isMenuDrawerOpen, setIsMenuDrawerOpen] = useState(false);

  const isSessionLoading = status === "loading";
  const rawRole = ((session?.user as any)?.role || "").toLowerCase();
  const userRole: UserRole = (
    ["admin", "warehouse", "salesman", "cashier", "accounts", "hr", "supplier", "manager", "sales", "driver"].includes(rawRole)
      ? rawRole
      : (isSessionLoading ? "loading" : "salesman")
  ) as UserRole;
  const userName = session?.user?.name || (isSessionLoading ? "Loading..." : "Staff");
  // On the role's own panel URL (/salesman, /driver …) the middleware shows that
  // panel's home page, so the menu treats the address as that page.
  const ownPanel = panelForRole(userRole);
  const pathname = ownPanel && rawPathname === `/${ownPanel.slug}` ? ownPanel.home : rawPathname;
  const logoutUrl = ownPanel ? `/login?panel=${ownPanel.slug}` : "/login";


  // Role-customized bottom tabs
  const getNavTabs = () => {
    switch (userRole) {
      case "driver":
        return [
          { label: "Deliveries", href: "/driver/deliveries", icon: Truck },
          { label: "Salary", href: "/driver/salary", icon: DollarSign },
          { isFab: true },
          { label: "Profile", href: "/staff/profile", icon: ShieldCheck },
          { label: "Menu", isMenu: true, icon: Menu },
        ];
      case "cashier":
        return [
          { label: "Home", href: "/dashboard", icon: LayoutDashboard },
          { label: "Invoices", href: "/sales/invoices", icon: Receipt },
          { isFab: true },
          { label: "Payments", href: "/sales/payments", icon: CreditCard },
          { label: "Menu", isMenu: true, icon: Menu },
        ];
      case "salesman":
      case "sales":
        return [
          { label: "Home", href: "/dashboard", icon: LayoutDashboard },
          { label: "Estimates", href: "/sales/estimates", icon: FileText },
          { isFab: true },
          { label: "Products", href: "/masters/items", icon: Package },
          { label: "Menu", isMenu: true, icon: Menu },
        ];
      case "warehouse":
        return [
          { label: "Home", href: "/dashboard", icon: LayoutDashboard },
          { label: "Godown", href: "/warehouse", icon: Warehouse },
          { isFab: true },
          { label: "Dispatch", href: "/sales/dispatch", icon: Truck },
          { label: "Menu", isMenu: true, icon: Menu },
        ];
      case "accounts":
        return [
          { label: "Home", href: "/dashboard", icon: LayoutDashboard },
          { label: "Billing", href: "/sales/invoices", icon: Receipt },
          { isFab: true },
          { label: "Reports", href: "/reports/sales-out", icon: FileText },
          { label: "Menu", isMenu: true, icon: Menu },
        ];
      case "hr":
        return [
          { label: "Home", href: "/dashboard", icon: LayoutDashboard },
          { label: "Staff", href: "/staff/attendance", icon: UserCheck },
          { isFab: true },
          { label: "Salary", href: "/staff/salary", icon: DollarSign },
          { label: "Menu", isMenu: true, icon: Menu },
        ];
      case "manager":
        return [
          { label: "Home", href: "/dashboard", icon: LayoutDashboard },
          { label: "Billing", href: "/sales/invoices", icon: Receipt },
          { isFab: true },
          { label: "Dispatch", href: "/sales/dispatch", icon: Truck },
          { label: "Menu", isMenu: true, icon: Menu },
        ];
      default: // admin
        return [
          { label: "Home", href: "/dashboard", icon: LayoutDashboard },
          { label: "Billing", href: "/sales/invoices", icon: Receipt },
          { isFab: true },
          { label: "Godown", href: "/warehouse", icon: Warehouse },
          { label: "Menu", isMenu: true, icon: Menu },
        ];
    }
  };

  const tabs = getNavTabs();

  // Filter full menu groups by role
  const visibleNavGroups = NAV_GROUPS.map((group) => {
    if (group.roles && !group.roles.includes(userRole) && userRole !== "admin") return null;
    const visibleItems = group.items.filter((item) => {
      if (userRole === "admin") return true;
      if (!item.roles) return true;
      return item.roles.includes(userRole);
    });
    if (visibleItems.length === 0) return null;
    return { ...group, items: visibleItems };
  }).filter(Boolean) as typeof NAV_GROUPS;

  return (
    <>
      {/* ─── FLOATING NATIVE MOBILE BOTTOM NAVIGATION BAR ─────────────────── */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-50 pointer-events-auto print:hidden">
        <div className="mx-3 mb-3 bg-[#1B2537]/90 backdrop-blur-2xl border border-white/15 rounded-3xl shadow-[0_12px_32px_rgba(0,0,0,0.4)] px-2 py-1.5 flex items-center justify-around">
          {tabs.map((tab, idx) => {
            if (tab.isFab) {
              return (
                <div key="fab" className="relative -top-5 flex flex-col items-center">
                  <button
                    onClick={() => setIsQuickActionsOpen(true)}
                    className="w-13 h-13 rounded-full bg-gradient-to-tr from-[#76C043] via-[#8CE846] to-[#5ea133] text-slate-950 flex items-center justify-center shadow-[0_8px_20px_rgba(118,192,67,0.5)] border-3 border-[#1B2537] active:scale-90 transition-transform"
                    aria-label="Quick Actions"
                  >
                    <Plus className="w-7 h-7 stroke-[2.8]" />
                  </button>
                  <span className="text-[10px] font-black text-[#76C043] mt-0.5 tracking-tight">Quick</span>
                </div>
              );
            }

            if (tab.isMenu) {
              const Icon = tab.icon!;
              return (
                <button
                  key="menu"
                  onClick={() => setIsMenuDrawerOpen(true)}
                  className="flex flex-col items-center justify-center flex-1 py-1.5 text-slate-400 hover:text-white transition-colors"
                >
                  <Icon className="w-5 h-5 stroke-[2.2]" />
                  <span className="text-[10px] font-bold mt-1 tracking-tight">Menu</span>
                </button>
              );
            }

            const Icon = tab.icon!;
            const isActive = pathname === tab.href || (tab.href !== "/dashboard" && pathname.startsWith(tab.href!));

            return (
              <Link
                key={tab.href}
                href={tab.href!}
                className={cn(
                  "flex flex-col items-center justify-center flex-1 py-1.5 transition-all relative",
                  isActive ? "text-[#76C043] font-bold" : "text-slate-400 hover:text-slate-200"
                )}
              >
                <div className="relative">
                  <Icon className={cn("w-5 h-5 transition-transform", isActive ? "scale-110 stroke-[2.5]" : "stroke-[2]")} />
                  {isActive && (
                    <motion.div
                      layoutId="activeIndicator"
                      className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 bg-[#76C043] rounded-full shadow-[0_0_8px_#76C043]"
                    />
                  )}
                </div>
                <span className="text-[10px] mt-1 tracking-tight leading-none">{tab.label}</span>
              </Link>
            );
          })}
        </div>
      </div>

      {/* ─── QUICK ACTIONS BOTTOM SHEET MODAL ─────────────────────────────── */}
      <Dialog open={isQuickActionsOpen} onOpenChange={setIsQuickActionsOpen}>
        <DialogContent className="max-w-md rounded-3xl p-5 bg-[#1B2537] text-white border-white/15">
          <DialogHeader className="text-left">
            <DialogTitle className="flex items-center justify-between text-base font-black">
              <span className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-[#76C043]" /> ⚡ Quick Actions Hub
              </span>
              <Badge className="bg-[#76C043]/20 text-[#76C043] border-[#76C043]/30 font-bold text-[10px]">
                {activeLocation.code}
              </Badge>
            </DialogTitle>
            <DialogDescription className="text-slate-400 text-xs">
              One-tap shortcuts for rapid showroom & godown operations
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-2.5 my-2">
            {userRole === "driver" ? (
              <>
                {/* Driver Quick 1: Deliveries */}
                <button
                  onClick={() => {
                    setIsQuickActionsOpen(false);
                    router.push("/driver/deliveries");
                  }}
                  className="p-3 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10 text-left transition-all group flex flex-col justify-between h-24"
                >
                  <div className="w-8 h-8 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center font-bold group-hover:scale-110 transition-transform">
                    <Truck className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-white">My Deliveries</p>
                    <p className="text-[10px] text-slate-400">Assigned Orders</p>
                  </div>
                </button>

                {/* Driver Quick 2: Salary */}
                <button
                  onClick={() => {
                    setIsQuickActionsOpen(false);
                    router.push("/driver/salary");
                  }}
                  className="p-3 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10 text-left transition-all group flex flex-col justify-between h-24"
                >
                  <div className="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold group-hover:scale-110 transition-transform">
                    <DollarSign className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-white">Salary & Advance</p>
                    <p className="text-[10px] text-slate-400">Monthly Payout</p>
                  </div>
                </button>

                {/* Driver Quick 3: Profile */}
                <button
                  onClick={() => {
                    setIsQuickActionsOpen(false);
                    router.push("/staff/profile");
                  }}
                  className="p-3 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10 text-left transition-all group flex flex-col justify-between h-24"
                >
                  <div className="w-8 h-8 rounded-xl bg-blue-500/20 text-blue-400 flex items-center justify-center font-bold group-hover:scale-110 transition-transform">
                    <ShieldCheck className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-white">My Profile</p>
                    <p className="text-[10px] text-slate-400">Vehicle & KYC</p>
                  </div>
                </button>

                {/* Driver Quick 4: Attendance */}
                <button
                  onClick={() => {
                    setIsQuickActionsOpen(false);
                    router.push("/staff/attendance");
                  }}
                  className="p-3 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10 text-left transition-all group flex flex-col justify-between h-24"
                >
                  <div className="w-8 h-8 rounded-xl bg-purple-500/20 text-purple-400 flex items-center justify-center font-bold group-hover:scale-110 transition-transform">
                    <Clock className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-white">Punch Attendance</p>
                    <p className="text-[10px] text-slate-400">Daily In/Out</p>
                  </div>
                </button>
              </>
            ) : (
              <>
                {/* Quick 1: Attendance */}
                <button
                  onClick={() => {
                    setIsQuickActionsOpen(false);
                    router.push("/staff/attendance");
                  }}
                  className="p-3 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10 text-left transition-all group flex flex-col justify-between h-24"
                >
                  <div className="w-8 h-8 rounded-xl bg-blue-500/20 text-blue-400 flex items-center justify-center font-bold group-hover:scale-110 transition-transform">
                    <Clock className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-white">Punch Attendance</p>
                    <p className="text-[10px] text-slate-400">Check-in / Check-out</p>
                  </div>
                </button>

                {/* Quick 2: Estimate */}
                {userRole === "salesman" && (
                  <button
                    onClick={() => {
                      setIsQuickActionsOpen(false);
                      router.push("/sales/estimates");
                    }}
                    className="p-3 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10 text-left transition-all group flex flex-col justify-between h-24"
                  >
                    <div className="w-8 h-8 rounded-xl bg-purple-500/20 text-purple-400 flex items-center justify-center font-bold group-hover:scale-110 transition-transform">
                      <FileText className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-white">New Estimate</p>
                      <p className="text-[10px] text-slate-400">Commercial Quote</p>
                    </div>
                  </button>
                )}

                {/* Quick 3: Tax Invoice */}
                {userRole !== "salesman" && (
                  <button
                    onClick={() => {
                      setIsQuickActionsOpen(false);
                      router.push("/sales/invoices");
                    }}
                    className="p-3 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10 text-left transition-all group flex flex-col justify-between h-24"
                  >
                    <div className="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold group-hover:scale-110 transition-transform">
                      <Receipt className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-white">Tax Invoice (POS)</p>
                      <p className="text-[10px] text-slate-400">Generate GST Bill</p>
                    </div>
                  </button>
                )}

                {/* Quick 4: Receive Payment */}
                {(userRole === "cashier" || userRole === "admin" || userRole === "manager") && (
                  <button
                    onClick={() => {
                      setIsQuickActionsOpen(false);
                      router.push("/sales/payments");
                    }}
                    className="p-3 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10 text-left transition-all group flex flex-col justify-between h-24"
                  >
                    <div className="w-8 h-8 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center font-bold group-hover:scale-110 transition-transform">
                      <CreditCard className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-white">Receive Payment</p>
                      <p className="text-[10px] text-slate-400">Cash / UPI / EMI</p>
                    </div>
                  </button>
                )}

                {/* Quick 5: Stock Lookup */}
                <button
                  onClick={() => {
                    setIsQuickActionsOpen(false);
                    router.push(userRole === "warehouse" ? "/warehouse" : "/masters/items");
                  }}
                  className="p-3 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10 text-left transition-all group flex flex-col justify-between h-24"
                >
                  <div className="w-8 h-8 rounded-xl bg-cyan-500/20 text-cyan-400 flex items-center justify-center font-bold group-hover:scale-110 transition-transform">
                    <ScanBarcode className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-white">Stock & Prices</p>
                    <p className="text-[10px] text-slate-400">Live Item Catalog</p>
                  </div>
                </button>

                {/* Quick 6: Low Stock Reorder */}
                <button
                  onClick={() => {
                    setIsQuickActionsOpen(false);
                    router.push("/purchase/low-stock");
                  }}
                  className="p-3 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10 text-left transition-all group flex flex-col justify-between h-24"
                >
                  <div className="w-8 h-8 rounded-xl bg-rose-500/20 text-rose-400 flex items-center justify-center font-bold group-hover:scale-110 transition-transform">
                    <AlertTriangle className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-white">Low Stock</p>
                    <p className="text-[10px] text-slate-400">Auto Reorder</p>
                  </div>
                </button>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ─── FULL MOBILE MENU DRAWER ──────────────────────────────────────── */}
      <Dialog open={isMenuDrawerOpen} onOpenChange={setIsMenuDrawerOpen}>
        <DialogContent className="max-w-md h-[88vh] rounded-t-3xl p-0 bg-[#1B2537] text-white border-white/15 overflow-y-auto flex flex-col">
          {/* Drawer Header */}
          <div className="p-4 border-b border-white/10 bg-black/20 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-[#76C043] to-emerald-400 flex items-center justify-center text-slate-950 font-black text-base shadow-md">
                {(userName[0] || "U").toUpperCase()}
              </div>
              <div>
                <h3 className="font-bold text-sm text-white leading-tight">{userName}</h3>
                <p className="text-[11px] text-[#76C043] font-semibold">{userRole.toUpperCase()} • {activeLocation.code}</p>
              </div>
            </div>
            <button
              onClick={() => setIsMenuDrawerOpen(false)}
              className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-slate-300 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Location Switcher Quick Bar */}
          <div className="p-3 bg-white/5 border-b border-white/10 flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <Store className="w-4 h-4 text-[#76C043] shrink-0" />
              <span className="text-xs font-semibold truncate">{activeLocation.name}</span>
            </div>
            <Link
              href="/staff/profile"
              onClick={() => setIsMenuDrawerOpen(false)}
              className="text-[11px] font-bold text-[#76C043] hover:underline shrink-0"
            >
              My Profile →
            </Link>
          </div>

          {/* Navigation Groups List */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {visibleNavGroups.map((group) => (
              <div key={group.title} className="space-y-1.5">
                <p className="text-[10px] font-black uppercase text-slate-400 tracking-wider px-2">
                  {group.title}
                </p>
                <div className="grid grid-cols-1 gap-1">
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    const isItemActive = pathname === item.href;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        {...(item.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                        onClick={() => setIsMenuDrawerOpen(false)}
                        className={cn(
                          "flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-semibold transition-all",
                          isItemActive 
                            ? "bg-[#30539C] text-white shadow-md font-bold" 
                            : "text-slate-300 hover:bg-white/10 hover:text-white"
                        )}
                      >
                        <div className="flex items-center gap-2.5">
                          <Icon className="w-4 h-4" />
                          <span>{item.title}</span>
                        </div>
                        <ChevronRight className="w-3.5 h-3.5 opacity-60" />
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* Drawer Footer */}
          <div className="p-3 border-t border-white/10 bg-black/30 flex items-center justify-between">
            <button
              onClick={() => signOut({ callbackUrl: logoutUrl })}
              className="flex items-center gap-2 px-3 py-2 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 text-xs font-bold transition-colors"
            >
              <LogOut className="w-4 h-4" />
              <span>Logout</span>
            </button>
            <span className="text-[10px] text-slate-400 font-mono">ValuePlus ERP v2.4</span>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
