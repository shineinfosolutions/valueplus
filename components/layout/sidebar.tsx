"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useMemo } from "react";
import { useSession, signOut } from "next-auth/react";
import { motion, AnimatePresence } from "framer-motion";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { panelForRole } from "@/lib/role-routes";
import { NAV_GROUPS, UserRole } from "@/constants/navigation";
import { useBranch } from "@/context/BranchContext";
import { 
  ChevronDown, Zap, Sparkles, MapPin, Phone, Building2, 
  Warehouse, Store, Check, ArrowRightLeft, ShieldCheck, User, LogOut, ExternalLink
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// Exact ValuePlus Logo Component
function ValuePlusBrand() {
  return (
    <div className="flex flex-col items-center justify-center w-full py-1">
      <div className="flex items-center text-[26px] font-black tracking-tight leading-none">
        <span className="text-white">VALUE</span>
        <span className="text-[#76C043]">PLUS</span>
      </div>
      <div className="flex items-center gap-2 mt-1 opacity-90">
        <div className="h-[1px] w-3.5 bg-white/70" />
        <span className="text-white text-[10px] font-medium tracking-wide">रिश्ता विश्वास का</span>
        <div className="h-[1px] w-3.5 bg-white/70" />
      </div>
    </div>
  );
}

interface SidebarSectionProps {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

function SidebarSection({ title, children, defaultOpen = true }: SidebarSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="mb-2">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-between w-full px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-[#8A9BB3] hover:text-white transition-colors group"
      >
        <span>{title}</span>
        <ChevronDown
          className={cn("w-3.5 h-3.5 transition-transform duration-200", isOpen ? "rotate-0" : "-rotate-90")}
        />
      </button>
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="space-y-0.5 pb-2">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const ROLE_DISPLAY_NAMES: Record<string, { label: string; bg: string; text: string }> = {
  admin: { label: "SUPER ADMIN", bg: "bg-amber-500/20 border-amber-400/40", text: "text-amber-300" },
  warehouse: { label: "GODOWN INCHARGE", bg: "bg-blue-500/20 border-blue-400/40", text: "text-blue-300" },
  salesman: { label: "SALES EXECUTIVE", bg: "bg-emerald-500/20 border-emerald-400/40", text: "text-emerald-300" },
  cashier: { label: "CASHIER & POS", bg: "bg-purple-500/20 border-purple-400/40", text: "text-purple-300" },
  accounts: { label: "ACCOUNTS & GST", bg: "bg-cyan-500/20 border-cyan-400/40", text: "text-cyan-300" },
  hr: { label: "HR & PAYROLL", bg: "bg-rose-500/20 border-rose-400/40", text: "text-rose-300" },
  supplier: { label: "SUPPLIER PORTAL", bg: "bg-orange-500/20 border-orange-400/40", text: "text-orange-300" },
  manager: { label: "STORE INCHARGE / ADMIN", bg: "bg-teal-500/20 border-teal-400/40", text: "text-teal-300" },
  sales: { label: "SALES EXECUTIVE", bg: "bg-emerald-500/20 border-emerald-400/40", text: "text-emerald-300" },
  driver: { label: "COURIER & DELIVERY BOY", bg: "bg-amber-500/20 border-amber-400/40", text: "text-amber-300" },
};

export function Sidebar() {
  const rawPathname = usePathname();
  const router = useRouter();
  const { data: session, status } = useSession();
  const { activeLocation, locations, setActiveLocation, isGodown } = useBranch();

  const isSessionLoading = status === "loading";
  const rawRole = (session?.user as any)?.role;
  const userRole: UserRole = (rawRole ? rawRole.toLowerCase() : (isSessionLoading ? "loading" : "salesman")) as any;
  const userName = session?.user?.name || (isSessionLoading ? "Loading..." : "Staff User");
  // On the role's own panel URL (/salesman, /driver …) the middleware shows that
  // panel's home page, so the menu treats the address as that page.
  const ownPanel = panelForRole(userRole);
  const pathname = ownPanel && rawPathname === `/${ownPanel.slug}` ? ownPanel.home : rawPathname;
  const logoutUrl = ownPanel ? `/login?panel=${ownPanel.slug}` : "/login";

  const userDesignation = (session?.user as any)?.designation || "Staff Member";
  const roleConfig = ROLE_DISPLAY_NAMES[userRole] || { label: "AUTHENTICATING", bg: "bg-white/10 border-white/20", text: "text-white/80" };

  // Filter navigation groups based on current user's role
  const visibleGroups = useMemo(() => {
    if (isSessionLoading) {
      return [];
    }

    return NAV_GROUPS.map((group) => {
      // If group has role restrictions and userRole is not admin, check if group allowed
      if (group.roles && !group.roles.includes(userRole) && userRole !== "admin") {
        return null;
      }

      // Filter items inside the group
      const visibleItems = group.items.filter((item) => {
        if (userRole === "admin") return true;
        if (!item.roles) return true;
        return item.roles.includes(userRole);
      });

      if (visibleItems.length === 0) return null;

      return {
        ...group,
        items: visibleItems,
      };
    }).filter(Boolean) as typeof NAV_GROUPS;
  }, [isSessionLoading, userRole]);

  return (
    <aside className="hidden md:flex fixed left-0 top-0 z-40 h-screen w-64 flex-col bg-[#30539C] shadow-[4px_0_24px_rgba(48,83,156,0.15)] border-r border-white/10 print:hidden">
      {/* Brand Header */}
      <div className="flex items-center justify-center px-4 h-20 border-b border-white/10 bg-black/5 flex-shrink-0">
        <ValuePlusBrand />
      </div>

      {/* Dynamic Branch / Godown Switcher Card */}
      <div className="px-3 py-2.5 flex-shrink-0 border-b border-white/10 bg-black/10">
        {userRole === "admin" || (session?.user as any)?.assignedWarehouseName === "ALL" || (session?.user as any)?.canSwitchWarehouse ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="w-full p-2.5 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 shadow-sm text-left transition-all group flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <div className={cn(
                    "w-7 h-7 rounded-lg flex items-center justify-center text-white text-xs font-black flex-shrink-0 shadow-sm",
                    isGodown ? "bg-amber-600" : "bg-[#76C043]"
                  )}>
                    {isGodown ? <Warehouse className="w-4 h-4" /> : <Store className="w-4 h-4" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className="text-white text-[11px] font-black tracking-tight leading-tight truncate">
                        {activeLocation.name}
                      </p>
                    </div>
                    <p className={cn("text-[9px] font-bold mt-0.5 uppercase tracking-wider", isGodown ? "text-amber-300" : "text-[#76C043]")}>
                      {isGodown ? "Central Godown" : "Retail Showroom"} • {activeLocation.city}
                    </p>
                  </div>
                </div>
                <ChevronDown className="w-3.5 h-3.5 text-white/60 group-hover:text-white transition-colors ml-1 flex-shrink-0" />
              </button>
            </DropdownMenuTrigger>

            <DropdownMenuContent align="start" className="w-64 rounded-xl p-1 shadow-2xl bg-[#1B2537] border-white/15 text-white">
              <DropdownMenuLabel className="text-[10px] font-extrabold uppercase text-slate-400 px-2 py-1">
                Switch Showroom / Godown
              </DropdownMenuLabel>
              <DropdownMenuSeparator className="bg-white/10" />

              <div className="max-h-60 overflow-y-auto space-y-1">
                {locations.map((loc) => {
                  const isSelected = loc.id === activeLocation.id;
                  const locIsGodown = loc.type === "warehouse";
                  return (
                    <DropdownMenuItem
                      key={loc.id}
                      onClick={() => {
                        setActiveLocation(loc);
                        if (locIsGodown) {
                          router.push("/warehouse");
                        }
                      }}
                      className={cn(
                        "cursor-pointer rounded-lg px-2 py-1.5 text-xs flex items-center justify-between text-white hover:bg-white/10 focus:bg-white/15 focus:text-white",
                        isSelected && "bg-white/15 font-bold"
                      )}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {locIsGodown ? (
                          <Warehouse className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                        ) : (
                          <Store className="w-3.5 h-3.5 text-[#76C043] flex-shrink-0" />
                        )}
                        <div className="truncate">
                          <p className="text-xs truncate">{loc.name}</p>
                          <p className="text-[9px] text-slate-400 font-mono">{loc.code} • {loc.city}</p>
                        </div>
                      </div>
                      {isSelected && <Check className="w-3.5 h-3.5 text-[#76C043] flex-shrink-0 ml-1" />}
                    </DropdownMenuItem>
                  );
                })}
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <div className="w-full p-2.5 rounded-xl bg-white/10 border border-white/15 shadow-sm text-left flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <div className={cn(
                "w-7 h-7 rounded-lg flex items-center justify-center text-white text-xs font-black flex-shrink-0 shadow-sm",
                isGodown ? "bg-amber-600" : "bg-[#76C043]"
              )}>
                {isGodown ? <Warehouse className="w-4 h-4" /> : <Store className="w-4 h-4" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-white text-[11px] font-black tracking-tight leading-tight truncate">
                  {activeLocation.name}
                </p>
                <p className="text-[9px] font-bold mt-0.5 text-slate-300 uppercase tracking-wider">
                  🔒 Assigned Location
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Role Badge Indicator */}
        <div className="flex items-center justify-between mt-2 pt-1.5 border-t border-white/10 text-[10px]">
          <div className="flex items-center gap-1 text-white/80 min-w-0 flex-1 mr-1">
            <User className="w-2.5 h-2.5 text-[#76C043] shrink-0" />
            <span className="truncate font-medium text-[10px]">{userName.split("(")[0].trim()}</span>
          </div>
          <span className={cn("px-1.5 py-0.5 rounded text-[8.5px] font-mono font-extrabold border shrink-0", roleConfig.bg, roleConfig.text)}>
            {roleConfig.label}
          </span>
        </div>
      </div>

      {/* Navigation Groups */}
      <ScrollArea className="flex-1 px-3 py-3">
        {isSessionLoading ? (
          <div className="space-y-3 px-1 py-2 animate-pulse">
            <div className="h-3.5 w-20 bg-white/20 rounded-md" />
            <div className="h-8 w-full bg-white/10 rounded-xl" />
            <div className="h-8 w-full bg-white/10 rounded-xl" />
            <div className="h-3.5 w-24 bg-white/20 rounded-md mt-4" />
            <div className="h-8 w-full bg-white/10 rounded-xl" />
            <div className="h-8 w-full bg-white/10 rounded-xl" />
          </div>
        ) : (
          visibleGroups.map((group) => {
            const isGroupActive = group.items.some(
              (item) =>
                pathname === item.href ||
                (item.href !== "/dashboard" && pathname.startsWith(item.href))
            );
            return (
              <SidebarSection
                key={group.title}
                title={group.title}
                defaultOpen={
                  isGroupActive ||
                  group.title === "Overview" ||
                  group.title === "Godown & Logistics Hub" ||
                  group.title === "Sales & Billing"
                }
              >
              {group.items.map((item) => {
                const isActive =
                  pathname === item.href ||
                  (item.href !== "/dashboard" && pathname.startsWith(item.href));
                const Icon = item.icon;

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    {...(item.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                    className={cn(
                      "flex items-center gap-3 px-3 py-2 rounded-xl text-[12.5px] font-medium transition-all duration-200 cursor-pointer group relative overflow-hidden",
                      isActive
                        ? "bg-white text-[#30539C] shadow-[0_4px_12px_rgba(0,0,0,0.1)] font-bold"
                        : "text-slate-300 hover:bg-white/10 hover:text-white"
                    )}
                  >
                    {isActive && (
                      <motion.div
                        layoutId="sidebar-active"
                        className="absolute left-0 w-1 h-5 bg-[#76C043] rounded-r-full"
                      />
                    )}
                    <Icon
                      className={cn(
                        "w-4 h-4 flex-shrink-0 transition-colors",
                        isActive ? "text-[#30539C]" : "text-slate-400 group-hover:text-white"
                      )}
                    />
                    <span className="flex-1 truncate tracking-wide">{item.title}</span>
                    {item.external && <ExternalLink className="w-3 h-3 flex-shrink-0 opacity-60" />}
                    {item.badge !== undefined && (
                      <span
                        className={cn(
                          "text-[10px] font-bold rounded-full px-2 py-0.5 min-w-[20px] text-center shadow-sm",
                          isActive ? "bg-[#76C043]/10 text-[#76C043]" : "bg-[#76C043] text-white"
                        )}
                      >
                        {item.badge}
                      </span>
                    )}
                  </Link>
                );
              })}
            </SidebarSection>
          );
        })
        )}
      </ScrollArea>

      {/* Bottom User & Logout Section */}
      <div className="flex-shrink-0 p-3 border-t border-white/10 bg-black/20 space-y-2">
        <div className="flex items-center justify-between px-2.5 py-2 rounded-xl bg-white/5 border border-white/10 text-white">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-[#76C043] to-emerald-400 flex items-center justify-center text-slate-950 font-black text-xs shrink-0 shadow-sm">
              {(userName[0] || "U").toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold text-white truncate leading-tight">{userName}</p>
              <p className="text-[10px] text-[#76C043] font-medium truncate">{roleConfig.label}</p>
            </div>
          </div>
          <button
            onClick={() => signOut({ callbackUrl: logoutUrl })}
            className="p-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 hover:text-rose-100 border border-rose-500/30 transition-colors shrink-0"
            title="Log out of Value Plus"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex items-center justify-between px-2 text-[10px] text-white/50">
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span>Master ERP Active</span>
          </div>
          <span className="font-mono text-[9px]">v2.4</span>
        </div>
      </div>
    </aside>
  );
}

