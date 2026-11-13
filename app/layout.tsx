import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import AuthProvider from "@/components/providers/AuthProvider";
import QueryProvider from "@/components/providers/QueryProvider";
import RealtimeProvider from "@/components/providers/RealtimeProvider";
import { OfflineSyncProvider } from "@/components/shared/offline-sync-provider";
import { NotificationPermissionPrompt } from "@/components/shared/NotificationPermissionPrompt";
import { AppDialogHost } from "@/components/shared/AppDialogs";

export const metadata: Metadata = {
  title: "ValuePlus ERP — Enterprise Resource Planning",
  description: "India's most premium ERP system for managing your business operations",
  keywords: ["ERP", "inventory", "accounting", "GST", "invoicing", "India", "ValuePlus"],
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "ValuePlus ERP",
  },
};

// Inter is downloaded at build time and served from our own domain (next/font), instead of a Google Fonts <link>
// that made every first visit wait on an outside server before painting. Exposed as --font-inter, which
// globals.css and tailwind.config.ts use. 900 is kept because some screens use font-black.
const inter = Inter({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800", "900"],
  display: "swap",
  variable: "--font-inter",
});

export const viewport = {
  themeColor: "#1B2537",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        <link rel="manifest" href="/manifest.json" />
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
        <meta name="theme-color" content="#1B2537" />
        {/* After a deploy, a page opened from an older build can ask for CSS / JS files that no longer exist and
            open unstyled ("AUTHENTICATING" forever). If one of the app's own files fails to load, reload once. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var K="vp-reloaded-at";function again(){try{var t=+sessionStorage.getItem(K)||0;if(Date.now()-t<30000)return;sessionStorage.setItem(K,String(Date.now()));}catch(e){}location.reload();}
window.addEventListener("error",function(e){var el=e&&e.target;var src=el&&(el.src||el.href)||"";if(src&&src.indexOf("/_next/")>-1&&(el.tagName==="SCRIPT"||el.tagName==="LINK"))again();},true);
window.addEventListener("unhandledrejection",function(e){var m=String(e&&e.reason&&(e.reason.message||e.reason.name)||"");if(/ChunkLoadError|Loading chunk|Loading CSS chunk|Failed to fetch dynamically imported module/i.test(m))again();});})();`,
          }}
        />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      </head>
      <body className="antialiased" suppressHydrationWarning>
        <QueryProvider>
          <AuthProvider>
            {/* Live updates over WebSocket: screens refresh when their data changes, no timers */}
            <RealtimeProvider>
              <OfflineSyncProvider>
                {children}
                {/* Asks first thing (login screen included) to allow notifications, so alerts reach a closed app */}
                <NotificationPermissionPrompt />
                {/* The app's own confirm / prompt boxes (window.confirm does not show in the Android app) */}
                <AppDialogHost />
              </OfflineSyncProvider>
            </RealtimeProvider>
          </AuthProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
