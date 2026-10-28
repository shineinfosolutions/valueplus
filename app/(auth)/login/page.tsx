"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { signIn, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Eye, EyeOff, ArrowRight, Shield, Zap, BarChart2, Lock, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ROLE_PANELS, panelForRole, panelForSlug, panelPathForRole, type RolePanel } from "@/lib/role-routes";

function ValuePlusBrand({ dark = false, size = "large" }: { dark?: boolean; size?: "small" | "large" }) {
  return (
    <div className="flex flex-col items-start justify-center">
      <div className={`flex items-center ${size === "large" ? "text-3xl" : "text-xl"} font-black tracking-tight leading-none`}>
        <span className={dark ? "text-slate-900" : "text-white"}>VALUE</span>
        <span className="text-[#76C043]">PLUS</span>
      </div>
      <div className="flex items-center gap-1.5 mt-1 opacity-90">
        <div className={`h-[1px] w-3 ${dark ? "bg-slate-400" : "bg-white/70"}`} />
        <span className={`${dark ? "text-slate-500" : "text-slate-200"} text-[10px] font-medium tracking-wide`}>रिश्ता विश्वास का</span>
        <div className={`h-[1px] w-3 ${dark ? "bg-slate-400" : "bg-white/70"}`} />
      </div>
    </div>
  );
}

const FEATURES = [
  { icon: BarChart2, title: "Real-time Analytics", desc: "Live business insights at your fingertips" },
  { icon: Shield, title: "GST Compliant", desc: "Fully compliant with Indian tax regulations" },
  { icon: Zap, title: "Lightning Fast", desc: "Process invoices and orders in seconds" },
];

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  // Which role's login this is (/salesman → /login?panel=salesman), and the page
  // the visitor was trying to reach. Read from the address on mount rather than
  // through useSearchParams, which would force a Suspense boundary at build time.
  const [panel, setPanel] = useState<RolePanel | undefined>(undefined);
  const [returnTo, setReturnTo] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setPanel(panelForSlug(params.get("panel")));
    const from = params.get("from") || "";
    // Same-site paths only — never follow an absolute URL handed in the query.
    setReturnTo(from.startsWith("/") && !from.startsWith("//") ? from : "");
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      const res = await signIn("credentials", {
        redirect: false,
        email: username,
        password: password,
      });

      if (res?.error) {
        setError("Login failed: " + res.error);
      } else if (res?.ok) {
        // The role comes from the account that just signed in, not from what was
        // typed in the username box.
        const session = await fetch("/api/auth/session").then((r) => r.json()).catch(() => null);
        const role = session?.user?.role as string | undefined;

        // Each panel has its own login: a salesman cannot sign in on the admin one.
        if (panel && panelForRole(role)?.slug !== panel.slug) {
          await signOut({ redirect: false });
          const own = panelForRole(role);
          setError(
            `This login is only for the ${panel.label} panel.${own ? ` Your panel: /${own.slug}` : ""}`
          );
          return;
        }

        window.location.href = returnTo || panelPathForRole(role);
      } else {
        setError("Invalid credentials");
      }
    } catch {
      setError("An unexpected error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-background">
      {/* Left branding panel - hidden on mobile */}
      <div className="hidden lg:flex lg:w-1/2 relative bg-[#1B2537] overflow-hidden">
        {/* Background gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-br from-[#1B2537] via-[#243552] to-[#1B2537]" />

        {/* Decorative elements */}
        <div className="absolute -top-40 -left-40 w-96 h-96 rounded-full bg-[#3F63AD]/20 blur-3xl" />
        <div className="absolute -bottom-40 -right-40 w-96 h-96 rounded-full bg-[#76C043]/15 blur-3xl" />

        <div className="relative z-10 flex flex-col h-full p-12 justify-between">
          {/* Top Branding */}
          <div className="flex items-center justify-between">
            <ValuePlusBrand size="large" />
            <a
              href="https://www.shineinfosolutions.in/"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2.5 px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/15 border border-white/20 backdrop-blur-md transition-all group"
            >
              <div className="w-6 h-6 rounded-full bg-white flex items-center justify-center p-0.5 shadow-sm">
                <img src="/bglogo.png" alt="Shine Infosolutions" className="w-full h-full object-contain" />
              </div>
              <div className="flex flex-col text-left">
                <span className="text-[8px] uppercase tracking-widest text-slate-300 font-semibold leading-none">Powered By</span>
                <span className="text-[11px] font-bold text-white group-hover:text-[#76C043] transition-colors leading-tight">Shine Infosolutions</span>
              </div>
            </a>
          </div>

          {/* Main content */}
          <div className="flex-1 flex flex-col justify-center max-w-md">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.1 }}
            >
              <h1 className="text-4xl font-bold text-white leading-tight mb-4">
                India's Most Premium{" "}
                <span className="text-[#76C043]">ERP System</span>
              </h1>
              <p className="text-slate-300 text-lg mb-10 leading-relaxed">
                Manage your entire business from one powerful platform. Invoicing, inventory, accounting, and GST — all in one place.
              </p>

              {/* Feature list */}
              <div className="space-y-5">
                {FEATURES.map((feature, i) => (
                  <motion.div
                    key={feature.title}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.5, delay: 0.2 + i * 0.1 }}
                    className="flex items-start gap-4"
                  >
                    <div className="w-10 h-10 rounded-xl bg-[#3F63AD]/30 border border-[#3F63AD]/40 flex items-center justify-center flex-shrink-0">
                      <feature.icon className="w-5 h-5 text-[#76C043]" />
                    </div>
                    <div>
                      <p className="text-white font-semibold">{feature.title}</p>
                      <p className="text-slate-400 text-sm mt-0.5">{feature.desc}</p>
                    </div>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          </div>

          {/* Footer note */}
          <p className="text-slate-400 text-sm">
            © 2026 ValuePlus ERP. Enterprise Grade Security & Reliability.
          </p>
        </div>
      </div>

      {/* Right form panel */}
      <div className="flex-1 flex flex-col justify-center items-center p-4 sm:p-8 bg-slate-50/50">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="w-full max-w-[430px]"
        >
          {/* Mobile Logo */}
          <div className="lg:hidden flex flex-col items-center mb-6">
            <ValuePlusBrand size="large" dark />
          </div>

          <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xl p-5 sm:p-8">
            <div className="mb-6 text-center sm:text-left">
              {panel && (
                <span className="inline-flex items-center gap-1.5 mb-2 px-2.5 py-1 rounded-full bg-[#30539C]/10 text-[#30539C] text-[10px] font-black uppercase tracking-wide">
                  <Lock className="w-3 h-3" /> {panel.label} Panel
                </span>
              )}
              <h2 className="text-2xl font-black text-slate-900 tracking-tight">
                {panel ? `${panel.label} Login` : "Welcome back"}
              </h2>
              <p className="text-xs sm:text-sm text-slate-500 mt-1">
                {panel ? `Sign in with your ${panel.label} account` : "Sign in to your Value Plus account"}
              </p>
            </div>

            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="username" className="text-xs font-bold text-slate-700">Username / Email / Phone</Label>
                <Input
                  id="username"
                  type="text"
                  placeholder="Email, username or mobile number"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  autoComplete="username"
                  className="h-11 rounded-xl text-xs font-semibold bg-slate-50/50"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password" className="text-xs font-bold text-slate-700">Password</Label>
                  <button
                    type="button"
                    className="text-[11px] text-[#3F63AD] hover:underline font-semibold"
                  >
                    Forgot password?
                  </button>
                </div>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                    className="h-11 pr-10 rounded-xl text-xs font-semibold bg-slate-50/50"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Remember me */}
              <div className="flex items-center gap-2 pt-0.5">
                <Checkbox
                  id="remember"
                  checked={rememberMe}
                  onCheckedChange={(v) => setRememberMe(v as boolean)}
                />
                <Label htmlFor="remember" className="text-xs font-medium text-slate-600 cursor-pointer">
                  Remember me for 30 days
                </Label>
              </div>

              {/* Error */}
              {error && (
                <div className="bg-red-50 border border-red-200 rounded-xl px-3.5 py-2.5 text-xs text-red-700 flex items-center gap-2">
                  <span className="w-4 h-4 rounded-full bg-red-200 flex items-center justify-center font-bold text-[10px] text-red-700 flex-shrink-0">!</span>
                  <span>{error}</span>
                </div>
              )}

              {/* Submit */}
              <Button
                type="submit"
                disabled={isLoading}
                size="lg"
                className="w-full gap-2 rounded-xl h-11 bg-[#30539C] hover:bg-[#203E78] text-white font-bold text-sm shadow-md"
              >
                {isLoading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Signing in...
                  </>
                ) : (
                  <>
                    Sign In
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </Button>
            </form>

            {/* A panel's own login lists the other panels instead of the quick-fill box */}
            {panel && (
              <div className="mt-5 pt-4 border-t border-slate-100">
                <p className="text-[10px] font-black text-slate-500 uppercase tracking-wide mb-2">Other panels</p>
                <div className="flex flex-wrap gap-1.5">
                  {ROLE_PANELS.filter((p) => p.slug !== panel.slug).map((p) => (
                    <Link
                      key={p.slug}
                      href={`/login?panel=${p.slug}`}
                      onClick={() => { setPanel(p); setError(""); }}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-50 hover:bg-blue-50 border border-slate-200 hover:border-[#3F63AD] text-[10.5px] font-bold text-slate-700 hover:text-[#3F63AD] transition-colors"
                    >
                      {p.label}
                    </Link>
                  ))}
                </div>
              </div>
            )}

          </div>

          <div className="mt-6 flex flex-col items-center gap-3 text-center">
            {/* One Android app for every role — it opens this same site and each
                person signs in with their own account. */}
            <a
              href="/downloads/valueplus.apk"
              download="ValuePlus.apk"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#1B2537] hover:bg-[#243552] text-white text-xs font-bold shadow-md transition-colors"
            >
              <Download className="w-4 h-4 text-[#76C043]" />
              Download Android App
            </a>
            <a
              href="https://www.shineinfosolutions.in/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2.5 px-4 py-1.5 rounded-full bg-white hover:bg-slate-50 border border-slate-200/80 shadow-sm transition-all text-slate-700 hover:border-[#3F63AD]/40 group"
            >
              <div className="w-5 h-5 rounded-full bg-white flex items-center justify-center overflow-hidden border border-slate-100 p-0.5">
                <img src="/bglogo.png" alt="Shine Infosolutions" className="w-full h-full object-contain" />
              </div>
              <span className="text-xs font-medium text-slate-600">
                Powered by <span className="font-bold text-slate-900 group-hover:text-[#3F63AD] transition-colors">Shine Infosolutions</span>
              </span>
            </a>
            <p className="text-[11px] text-muted-foreground">
              © 2026 ValuePlus ERP · All rights reserved · <span className="text-[#3F63AD] font-medium">Made in India 🇮🇳</span>
            </p>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
