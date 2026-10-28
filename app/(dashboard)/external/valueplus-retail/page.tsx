"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { PageShell } from "@/components/shared/page-shell";
import { Button } from "@/components/ui/button";
import { ExternalLink, RefreshCw, AlertTriangle, ShieldCheck } from "lucide-react";
import { AccessDenied } from "@/components/shared/role-guard";

/** Matches the roles this link is shown to in constants/navigation.ts. */
const ALLOWED_ROLES = ["admin", "manager", "accounts"];

/**
 * Embedded access to the Value Plus Retail customer portal.
 *
 * The login itself is never handled by this app — cp.valueplusretail.com runs
 * in an iframe on its own origin, so this page cannot read or fill its form
 * (the browser's same-origin policy blocks that by design, and rightly so for
 * a third-party login). What this page DOES do is keep the portal one click
 * away without leaving the ERP sidebar, and the browser's own password manager
 * remembers the login exactly as it would in any other tab — no credentials
 * are stored anywhere in this app.
 *
 * There is no reliable cross-origin way to detect "this site refused to be
 * framed" (X-Frame-Options and CSP frame-ancestors blocks fail silently, with
 * no error event JS can see). The timeout below is a heuristic: if the iframe
 * hasn't fired its own load event in a few seconds, something is probably
 * wrong, and the fallback offers a plain new-tab link instead.
 */

const CP_URL = "https://cp.valueplusretail.com/login";
const LOAD_TIMEOUT_MS = 6000;

export default function ValuePlusRetailPortalPage() {
  const { data: session, status } = useSession();
  const role = String((session?.user as any)?.role || "").toLowerCase();

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-3 border-[#30539C] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!ALLOWED_ROLES.includes(role)) {
    return <AccessDenied />;
  }

  return <ValuePlusRetailPortalInner />;
}

function ValuePlusRetailPortalInner() {
  const [loadState, setLoadState] = useState<"loading" | "loaded" | "blocked">("loading");
  const [reloadKey, setReloadKey] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLoadState("loading");
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setLoadState((s) => (s === "loading" ? "blocked" : s));
    }, LOAD_TIMEOUT_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [reloadKey]);

  const openNewTab = () => window.open(CP_URL, "_blank", "noopener,noreferrer");

  return (
    <PageShell
      title="Value Plus Retail — Customer Portal"
      subtitle="cp.valueplusretail.com, embedded. Your browser remembers the login here just like any other tab."
      breadcrumbs={[{ label: "External Portals" }, { label: "Value Plus Retail (CP)" }]}
      actions={
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setReloadKey((k) => k + 1)}
          >
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Reload
          </Button>
          <Button variant="outline" size="sm" onClick={openNewTab}>
            <ExternalLink className="w-3.5 h-3.5 mr-1.5" /> Open in New Tab
          </Button>
        </div>
      }
    >
      <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-3 flex items-start gap-2.5">
        <ShieldCheck className="w-4 h-4 text-[#3F63AD] shrink-0 mt-0.5" />
        <p className="text-xs text-slate-700 leading-relaxed">
          This app never sees the CP login — it only embeds the page. When you sign in below, use your
          browser's own "save password" prompt if you want it remembered; nothing is stored on our
          server.
        </p>
      </div>

      <div
        className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden relative"
        style={{ height: "calc(100vh - 230px)", minHeight: 420 }}
      >
        {loadState === "blocked" ? (
          <div className="h-full flex flex-col items-center justify-center gap-3 p-8 text-center">
            <AlertTriangle className="w-10 h-10 text-amber-500" />
            <p className="font-bold text-slate-800">This page didn't load inside the embed</p>
            <p className="text-sm text-slate-500 max-w-md">
              cp.valueplusretail.com may be refusing to open inside another page, or the connection is
              slow. Open it in its own tab instead — your saved login still applies there.
            </p>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => setReloadKey((k) => k + 1)}>
                <RefreshCw className="w-4 h-4 mr-1.5" /> Try Again
              </Button>
              <Button onClick={openNewTab}>
                <ExternalLink className="w-4 h-4 mr-1.5" /> Open in New Tab
              </Button>
            </div>
          </div>
        ) : (
          <>
            {loadState === "loading" && (
              <div className="absolute inset-0 flex items-center justify-center bg-white z-10">
                <div className="w-8 h-8 border-3 border-[#30539C] border-t-transparent rounded-full animate-spin" />
              </div>
            )}
            <iframe
              key={reloadKey}
              src={CP_URL}
              title="Value Plus Retail Customer Portal"
              className="w-full h-full border-0"
              onLoad={() => {
                if (timerRef.current) clearTimeout(timerRef.current);
                setLoadState("loaded");
              }}
              referrerPolicy="no-referrer"
            />
          </>
        )}
      </div>
    </PageShell>
  );
}
