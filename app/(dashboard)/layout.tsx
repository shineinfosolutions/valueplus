import type { Metadata } from "next";
import { Sidebar } from "@/components/layout/sidebar";
import { Topnav } from "@/components/layout/topnav";
import { MobileBottomNav } from "@/components/layout/mobile-bottom-nav";
import { PWAInstallPrompt } from "@/components/shared/pwa-install-prompt";
import { DayCloseGate } from "@/components/shared/DayCloseGate";
import { FinancePayoutReminder } from "@/components/shared/FinancePayoutReminder";
import { Toaster } from "sonner";
import { BranchProvider } from "@/context/BranchContext";

export const metadata: Metadata = {
  title: "ValuePlus ERP",
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <BranchProvider>
      <div className="flex h-screen bg-[#F8FAFC] overflow-hidden">
        {/* Desktop Sidebar */}
        <Sidebar />

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col ml-0 md:ml-64 min-w-0 bg-[#F4F7FB] relative h-screen overflow-hidden">
          <Topnav />
          <main className="flex-1 overflow-y-auto pt-16 pb-24 md:pb-6 px-0">
            {children}
          </main>
        </div>

        {/* Native Mobile Bottom Navigation Bar */}
        <MobileBottomNav />

        {/* PWA 1-Click Install Banner */}
        <PWAInstallPrompt />

        {/* Blocks Sales/Billing + Cash Register until the pending day's cash audit is done */}
        <DayCloseGate />

        {/* Keeps asking for the bank account / UTR of finance payouts that have none yet */}
        <FinancePayoutReminder />

        {/* Offset below the top bar, so a pop-up never covers the bell or Logout. */}
        <Toaster position="top-right" richColors expand={false} offset={72} mobileOffset={{ top: 64 }} />
      </div>
    </BranchProvider>
  );
}
