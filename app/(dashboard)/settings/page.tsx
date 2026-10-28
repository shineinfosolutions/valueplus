"use client";
import { PageShell } from "@/components/shared/page-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Save, Building } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";

export default function SettingsPage() {
  const [companyName, setCompanyName] = useState("ValuePlus Trading Co. Pvt. Ltd.");
  const [gstin, setGstin] = useState("27AABCV1234A1Z5");
  const [email, setEmail] = useState("admin@valueplus.in");
  const [phone, setPhone] = useState("9876543210");
  const [address, setAddress] = useState("Plot 45, MIDC Andheri East, Mumbai 400093");
  const [state, setState] = useState("Maharashtra");
  const [currency, setCurrency] = useState("INR");
  const [dateFormat, setDateFormat] = useState("DD/MM/YYYY");

  return (
    <PageShell title="Settings" subtitle="Configure your ERP system" breadcrumbs={[{ label: "Settings" }]}>
      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="data-table-container p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-[#3F63AD]/10 flex items-center justify-center">
                <Building className="w-5 h-5 text-[#3F63AD]" />
              </div>
              <div>
                <h3 className="font-semibold">Company Information</h3>
                <p className="text-xs text-muted-foreground">Basic company details and registration info</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2 space-y-1.5"><Label>Company Name</Label><Input value={companyName} onChange={e => setCompanyName(e.target.value)} /></div>
              <div className="space-y-1.5"><Label>GSTIN</Label><Input value={gstin} onChange={e => setGstin(e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Email</Label><Input value={email} onChange={e => setEmail(e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Phone</Label><Input value={phone} onChange={e => setPhone(e.target.value)} /></div>
              <div className="space-y-1.5"><Label>State</Label>
                <Select value={state} onValueChange={setState}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["Maharashtra","Gujarat","Delhi","Karnataka","Tamil Nadu","Rajasthan"].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2 space-y-1.5"><Label>Address</Label><Input value={address} onChange={e => setAddress(e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Currency</Label>
                <Select value={currency} onValueChange={setCurrency}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="INR">INR — Indian Rupee</SelectItem>
                    <SelectItem value="USD">USD — US Dollar</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5"><Label>Date Format</Label>
                <Select value={dateFormat} onValueChange={setDateFormat}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DD/MM/YYYY">DD/MM/YYYY</SelectItem>
                    <SelectItem value="MM/DD/YYYY">MM/DD/YYYY</SelectItem>
                    <SelectItem value="YYYY-MM-DD">YYYY-MM-DD</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="mt-6 pt-6 border-t flex justify-end">
              <Button onClick={() => toast.success("Settings saved successfully!")}><Save className="w-4 h-4 mr-2" /> Save Settings</Button>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="data-table-container p-5">
            <h4 className="font-semibold mb-4">Quick Links</h4>
            <div className="space-y-1.5">
              {[["Company Details","/settings/company"],["Invoice Settings","#"],["GST Settings","#"],["Email Settings","#"],["Notification Preferences","#"],["User Management","/settings/users"],["Roles & Permissions","#"]].map(([label, href]) => (
                <a key={label} href={href} className="flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-slate-50 transition-colors text-sm text-muted-foreground hover:text-foreground">
                  → {label}
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
