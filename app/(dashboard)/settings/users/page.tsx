"use client";

import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/shared/page-shell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Users,
  UserPlus,
  ShieldCheck,
  Building2,
  Warehouse,
  Store,
  Phone,
  Mail,
  Lock,
  DollarSign,
  FileText,
  CreditCard,
  CheckCircle2,
  AlertTriangle,
  Search,
  Edit2,
  Trash2,
  Eye,
  Camera,
  Coins,
  BadgePercent,
  Calendar,
  Sparkles,
  Award,
} from "lucide-react";
import { toast } from "sonner";
import { TableShimmer } from "@/components/shared/shimmer-skeleton";
import { formatCurrency } from "@/lib/utils";
import { ExportMenu } from "@/components/shared/ExportMenu";
import { todayInIndia } from "@/lib/today";

const ROLE_OPTIONS = [
  { value: "admin", label: "👑 Super Admin (Full Master Access)" },
  { value: "manager", label: "🏢 Store Manager / Incharge" },
  { value: "warehouse", label: "🏬 Warehouse / Godown Incharge" },
  { value: "driver", label: "🚚 Courier & Delivery Boy / Driver" },
  { value: "salesman", label: "👔 Salesman / Floor Executive" },
  { value: "cashier", label: "💳 Cashier / POS Billing Counter" },
  { value: "accounts", label: "📊 Accounts & GST Officer" },
  { value: "hr", label: "👥 HR & Payroll Manager" },
  { value: "supplier", label: "🏭 Supplier / External Vendor" },
];

export default function UsersAndStaffPage() {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isAdvanceModalOpen, setIsAdvanceModalOpen] = useState(false);
  const [selectedUserForAdvance, setSelectedUserForAdvance] = useState<any>(null);
  const [advanceAmountInput, setAdvanceAmountInput] = useState("");
  const [advanceNotesInput, setAdvanceNotesInput] = useState("");

  const [selectedUserForView, setSelectedUserForView] = useState<any | null>(null);
  const [isViewModalOpen, setIsViewModalOpen] = useState(false);

  const [selectedUserForEdit, setSelectedUserForEdit] = useState<any | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editActiveTab, setEditActiveTab] = useState<"login" | "kyc" | "salary">("login");
  const [editFormData, setEditFormData] = useState<any>({
    name: "",
    email: "",
    password: "",
    role: "salesman",
    mobile: "",
    avatar: "",
    address: "",
    city: "Gorakhpur",
    state: "Uttar Pradesh",
    pincode: "273008",
    idProofType: "Aadhaar Card",
    idProofNumber: "",
    idProofDoc: "",
    designation: "Sales Executive",
    monthlySalary: "25000",
    salaryType: "Fixed",
    joiningDate: "",
    advanceBalance: "0",
    monthlyAdvanceDeduction: "2000",
    bankName: "State Bank of India",
    bankAccountNo: "",
    bankIfsc: "SBIN0001234",
    assignedWarehouseName: "Ashoka Enterprises (Kunraghat Showroom)",
    assignedBrand: "",
    status: "active",
  });

  const [activeTab, setActiveTab] = useState<"login" | "kyc" | "salary">("login");

  const handleOpenView = (u: any) => {
    setSelectedUserForView(u);
    setIsViewModalOpen(true);
  };

  const handleOpenEdit = (u: any) => {
    setSelectedUserForEdit(u);
    setEditFormData({
      name: u.name || "",
      email: u.email || "",
      password: "",
      role: u.role || "salesman",
      mobile: u.mobile || "",
      avatar: u.avatar || "",
      address: u.address || "",
      city: u.city || "Gorakhpur",
      state: u.state || "Uttar Pradesh",
      pincode: u.pincode || "273008",
      idProofType: u.idProofType || "Aadhaar Card",
      idProofNumber: u.idProofNumber || "",
      idProofDoc: u.idProofDoc || "",
      designation: u.designation || "Staff",
      monthlySalary: String(u.monthlySalary || 0),
      salaryType: u.salaryType || "Fixed",
      joiningDate: u.joiningDate ? String(u.joiningDate).split("T")[0] : "",
      advanceBalance: String(u.advanceBalance || 0),
      monthlyAdvanceDeduction: String(u.monthlyAdvanceDeduction || 2000),
      bankName: u.bankName || "State Bank of India",
      bankAccountNo: u.bankAccountNo || "",
      bankIfsc: u.bankIfsc || "",
      assignedWarehouseName: u.assignedWarehouseName || "Ashoka Enterprises (Kunraghat Showroom)",
      assignedBrand: u.assignedBrand || "",
      status: u.status || "active",
    });
    setEditActiveTab("login");
    setIsEditModalOpen(true);
  };

  // Form State
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
    role: "salesman",
    mobile: "",
    avatar: "",
    address: "",
    city: "Gorakhpur",
    state: "Uttar Pradesh",
    pincode: "273008",
    idProofType: "Aadhaar Card",
    idProofNumber: "",
    idProofDoc: "",
    designation: "Sales Executive",
    monthlySalary: "25000",
    salaryType: "Fixed",
    joiningDate: todayInIndia(),
    advanceBalance: "0",
    monthlyAdvanceDeduction: "2000",
    bankName: "State Bank of India",
    bankAccountNo: "",
    bankIfsc: "SBIN0001234",
    assignedWarehouseName: "Ashoka Enterprises (Kunraghat Showroom)",
    assignedBrand: "",
  });

  // Fetch Brands Master
  const { data: brands = [] } = useQuery({
    queryKey: ["brands"],
    queryFn: async () => {
      const res = await fetch("/api/brands");
      const json = await res.json();
      return json.success ? json.data : [];
    },
  });

  // Fetch Users
  const { data: users = [], isLoading } = useQuery({
    queryKey: ["users-staff"],
    queryFn: async () => {
      const res = await fetch("/api/users");
      const json = await res.json();
      return json.success ? json.data : [];
    },
  });

  // Create User Mutation
  const createUserMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed to create user");
      return json;
    },
    onSuccess: (data: any) => {
      toast.success(data.message || "User created successfully!");
      setIsCreateModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ["users-staff"] });
      // Reset form
      setFormData({
        name: "",
        email: "",
        password: "",
        role: "salesman",
        mobile: "",
        avatar: "",
        address: "",
        city: "Gorakhpur",
        state: "Uttar Pradesh",
        pincode: "273008",
        idProofType: "Aadhaar Card",
        idProofNumber: "",
        idProofDoc: "",
        designation: "Sales Executive",
        monthlySalary: "25000",
        salaryType: "Fixed",
        joiningDate: todayInIndia(),
        advanceBalance: "0",
        monthlyAdvanceDeduction: "2000",
        bankName: "State Bank of India",
        bankAccountNo: "",
        bankIfsc: "SBIN0001234",
        assignedWarehouseName: "Ashoka Enterprises (Kunraghat Showroom)",
        assignedBrand: "",
      });
    },
    onError: (err: any) => toast.error(err.message),
  });

  // Advance Balance Mutation
  const updateAdvanceMutation = useMutation({
    mutationFn: async ({ id, newAdvance }: { id: string; newAdvance: number }) => {
      const res = await fetch("/api/users", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, advanceBalance: newAdvance }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed to update advance");
      return json;
    },
    onSuccess: () => {
      toast.success("Advance balance updated successfully!");
      setIsAdvanceModalOpen(false);
      setSelectedUserForAdvance(null);
      setAdvanceAmountInput("");
      queryClient.invalidateQueries({ queryKey: ["users-staff"] });
    },
    onError: (err: any) => toast.error(err.message),
  });

  // Update User Profile Mutation
  const updateUserMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await fetch("/api/users", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed to update user profile");
      return json;
    },
    onSuccess: (data: any) => {
      toast.success(data.message || "Staff profile updated successfully!");
      setIsEditModalOpen(false);
      setSelectedUserForEdit(null);
      queryClient.invalidateQueries({ queryKey: ["users-staff"] });
      if (selectedUserForView && selectedUserForView._id === data.data?._id) {
        setSelectedUserForView(data.data);
      }
    },
    onError: (err: any) => toast.error(err.message),
  });

  // Delete User Mutation
  const deleteUserMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/users?id=${id}`, { method: "DELETE" });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed to delete user");
      return json;
    },
    onSuccess: () => {
      toast.success("User deleted successfully!");
      queryClient.invalidateQueries({ queryKey: ["users-staff"] });
    },
    onError: (err: any) => toast.error(err.message),
  });

  // Filtered Users
  const filteredUsers = users.filter((u: any) => {
    const matchesSearch =
      u.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.mobile?.includes(searchQuery) ||
      u.designation?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.assignedBrand?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.idProofNumber?.toLowerCase().includes(searchQuery.toLowerCase());

    let matchesRole = true;
    if (roleFilter === "brand_rep") {
      matchesRole = Boolean(u.assignedBrand && u.assignedBrand.trim().length > 0);
    } else if (roleFilter !== "all") {
      matchesRole = u.role === roleFilter;
    }

    return matchesSearch && matchesRole;
  });

  // Aggregate Stats
  const totalPayrollBudget = users.reduce((acc: number, curr: any) => acc + (curr.monthlySalary || 0), 0);
  const totalAdvanceLoan = users.reduce((acc: number, curr: any) => acc + (curr.advanceBalance || 0), 0);
  const totalBrandReps = users.filter((u: any) => Boolean(u.assignedBrand && u.assignedBrand.trim().length > 0)).length;

  return (
    <PageShell
      title="Staff & User Management (KYC, Salary & Roles)"
      description="Create login credentials, manage Aadhaar/KYC identity proofs, brand representative assignments, base salary, advance loans, and showroom/godown permissions."
      actions={
        <ExportMenu
          title="Staff & Users"
          subtitle={`${filteredUsers.length} staff members`}
          data={(filteredUsers as any[]).map((u) => ({
            Name: u.name,
            Role: u.role,
            Designation: u.designation || "Staff",
            "Assigned Brand": u.assignedBrand || "General Store Staff",
            Location: u.assignedWarehouseName || "Kunraghat Showroom",
            Mobile: u.mobile || "",
            Email: u.email || "",
            "KYC Type": u.idProofType || "Aadhaar Card",
            "KYC Number": u.idProofNumber || "",
            "Monthly Salary": formatCurrency(u.monthlySalary || 0),
            "Advance Loan": formatCurrency(u.advanceBalance || 0),
          }))}
          filename="staff-users"
        />
      }
    >
      <div className="space-y-5">
        {/* KPI OVERVIEW CARDS */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-sm flex items-center justify-between">
            <div>
              <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Total Active Staff</p>
              <h3 className="text-2xl font-black text-slate-900 mt-1 font-mono">{users.length}</h3>
              <p className="text-[10px] text-slate-400 mt-0.5">{totalBrandReps} Brand Promoters (ISD)</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center">
              <Users className="w-5 h-5 text-[#30539C]" />
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-sm flex items-center justify-between">
            <div>
              <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Monthly Base Payroll</p>
              <h3 className="text-2xl font-black text-emerald-600 mt-1 font-mono">{formatCurrency(totalPayrollBudget)}</h3>
              <p className="text-[10px] text-slate-400 mt-0.5">Estimated gross liability</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center">
              <DollarSign className="w-5 h-5 text-emerald-600" />
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-sm flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Advance Loans Active</p>
                <h3 className="text-2xl font-black text-amber-600 mt-1 font-mono">{formatCurrency(totalAdvanceLoan)}</h3>
              </div>
              <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-center">
                <Coins className="w-5 h-5 text-amber-600" />
              </div>
            </div>
            <p className="text-[10px] text-slate-500 mt-2">Deductible in monthly salary cycles</p>
          </div>

          <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-sm flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Quick Action</p>
                <p className="text-xs font-extrabold text-slate-900 mt-0.5">Onboard Employee</p>
              </div>
              <div className="w-10 h-10 rounded-xl bg-purple-50 border border-purple-100 flex items-center justify-center">
                <ShieldCheck className="w-5 h-5 text-purple-600" />
              </div>
            </div>
            <Button
              onClick={() => setIsCreateModalOpen(true)}
              className="w-full mt-2 bg-[#76C043] hover:bg-[#68ac3b] text-white font-bold text-xs shadow-md h-8 rounded-lg"
            >
              <UserPlus className="w-3.5 h-3.5 mr-1.5" /> Add Staff / User
            </Button>
          </div>
        </div>

        {/* SEARCH & ROLE FILTER BAR */}
        <div className="p-3 bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-wrap items-center justify-between gap-3">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input
              placeholder="Search by Name, Brand (e.g. Haier), Mobile, Email, Aadhaar #..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-9 text-xs bg-slate-50 border-slate-200 font-medium"
            />
          </div>

          <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0">
            {[
              { id: "all", label: "All Users" },
              { id: "brand_rep", label: "🏷️ Brand Reps (ISD)" },
              { id: "salesman", label: "👔 Salesman" },
              { id: "cashier", label: "💳 Cashier" },
              { id: "warehouse", label: "🏬 Godown" },
              { id: "accounts", label: "📊 Accounts" },
              { id: "hr", label: "👥 HR" },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setRoleFilter(tab.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
                  roleFilter === tab.id
                    ? "bg-[#30539C] text-white shadow-sm"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* USERS & STAFF DIRECTORY TABLE */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
            <div>
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-800">
                Staff & Sales Representatives Directory ({filteredUsers.length})
              </h3>
              <p className="text-[11px] text-slate-500">Employee profiles, Brand affiliations, Role access & KYC</p>
            </div>
            <Button
              size="sm"
              onClick={() => setIsCreateModalOpen(true)}
              className="bg-[#30539C] hover:bg-[#203a70] text-white font-bold text-xs h-8"
            >
              <UserPlus className="w-3.5 h-3.5 mr-1" /> New Staff
            </Button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-100/75 border-b border-slate-200 text-slate-700 uppercase font-black tracking-wider text-[10px]">
                <tr>
                  <th className="p-3.5">Employee & Role</th>
                  <th className="p-3.5">Assigned Brand (ISD / Rep)</th>
                  <th className="p-3.5">Assigned Location</th>
                  <th className="p-3.5">KYC & Identity Proof</th>
                  <th className="p-3.5">Monthly Salary</th>
                  <th className="p-3.5">Advance Loan</th>
                  <th className="p-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {isLoading ? (
                  <tr>
                    <td colSpan={7} className="p-0">
                      <TableShimmer rows={6} cols={7} />
                    </td>
                  </tr>
                ) : filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-slate-400 font-medium">
                      No staff users found matching your search.
                    </td>
                  </tr>
                ) : (
                  filteredUsers.map((u: any) => {
                    const roleBadgeColor =
                      u.role === "admin"
                        ? "bg-amber-100 text-amber-900 border-amber-300"
                        : u.role === "warehouse"
                        ? "bg-blue-100 text-blue-900 border-blue-300"
                        : u.role === "cashier"
                        ? "bg-purple-100 text-purple-900 border-purple-300"
                        : u.role === "accounts"
                        ? "bg-cyan-100 text-cyan-900 border-cyan-300"
                        : u.role === "hr"
                        ? "bg-rose-100 text-rose-900 border-rose-300"
                        : "bg-emerald-100 text-emerald-900 border-emerald-300";

                    return (
                      <tr key={u._id} className="hover:bg-slate-50/80 transition-colors">
                        {/* Employee Details */}
                        <td className="p-3.5">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-[#30539C] to-[#5179cb] text-white flex items-center justify-center font-black text-sm shadow-sm flex-shrink-0">
                              {u.avatar ? (
                                <img src={u.avatar} alt={u.name} className="w-full h-full object-cover rounded-xl" />
                              ) : (
                                u.name?.substring(0, 2).toUpperCase()
                              )}
                            </div>
                            <div className="min-w-0">
                              <p className="font-extrabold text-slate-900 text-xs truncate">{u.name}</p>
                              <p className="text-[11px] text-slate-500 font-medium truncate">{u.designation || "Staff"}</p>
                              <div className="flex items-center gap-2 mt-1">
                                <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold border uppercase ${roleBadgeColor}`}>
                                  {u.role}
                                </span>
                                <span className="text-[10px] text-slate-400 font-mono flex items-center gap-0.5">
                                  <Mail className="w-2.5 h-2.5" /> {u.email}
                                </span>
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* Assigned Brand Column */}
                        <td className="p-3.5">
                          {u.assignedBrand ? (
                            <div className="space-y-1">
                              <Badge className="bg-blue-50 text-[#30539C] border-blue-300 font-extrabold text-[11px] px-2 py-0.5 shadow-2xs flex items-center gap-1 w-fit">
                                🏷️ {u.assignedBrand}
                              </Badge>
                              <p className="text-[10px] text-slate-500 font-medium">Company Sales Representative</p>
                            </div>
                          ) : (
                            <div>
                              <span className="text-[11px] text-slate-500 font-medium">General Store Staff</span>
                              <p className="text-[10px] text-slate-400">All Brands</p>
                            </div>
                          )}
                        </td>

                        {/* Location */}
                        <td className="p-3.5">
                          <div className="space-y-1">
                            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
                              {u.assignedWarehouseName?.toLowerCase().includes("godown") ? (
                                <Warehouse className="w-3.5 h-3.5 text-amber-600 flex-shrink-0" />
                              ) : (
                                <Store className="w-3.5 h-3.5 text-[#76C043] flex-shrink-0" />
                              )}
                              <span className="truncate max-w-[180px]">{u.assignedWarehouseName || "Kunraghat Showroom"}</span>
                            </div>
                            {u.mobile && (
                              <p className="text-[11px] text-slate-500 font-mono flex items-center gap-1">
                                <Phone className="w-2.5 h-2.5 text-slate-400" /> {u.mobile}
                              </p>
                            )}
                          </div>
                        </td>

                        {/* KYC Proof */}
                        <td className="p-3.5">
                          <div className="space-y-1">
                            <div className="flex items-center gap-1">
                              <ShieldCheck className="w-3 h-3 text-emerald-600" />
                              <span className="text-xs font-bold text-slate-800">{u.idProofType || "Aadhaar Card"}</span>
                            </div>
                            <p className="text-[11px] font-mono font-bold text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded inline-block">
                              {u.idProofNumber || "DOC-NOT-SUBMITTED"}
                            </p>
                          </div>
                        </td>

                        {/* Salary */}
                        <td className="p-3.5">
                          <div>
                            <p className="font-mono font-black text-xs text-slate-900">
                              {formatCurrency(u.monthlySalary || 0)}
                            </p>
                            <p className="text-[10px] text-slate-500 font-medium">
                              Type: <span className="font-bold text-slate-700">{u.salaryType || "Fixed"}</span>
                            </p>
                          </div>
                        </td>

                        {/* Advance Loan Balance */}
                        <td className="p-3.5">
                          <div>
                            <p className={`font-mono font-black text-xs ${u.advanceBalance > 0 ? "text-amber-600" : "text-slate-400"}`}>
                              {formatCurrency(u.advanceBalance || 0)}
                            </p>
                            <button
                              onClick={() => {
                                setSelectedUserForAdvance(u);
                                setAdvanceAmountInput(String(u.advanceBalance || 0));
                                setIsAdvanceModalOpen(true);
                              }}
                              className="text-[10px] text-blue-600 hover:underline font-bold mt-0.5 block"
                            >
                              + Adjust Advance
                            </button>
                          </div>
                        </td>

                        {/* Action Buttons */}
                        <td className="p-3.5 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleOpenView(u)}
                              title="View Full Staff Profile"
                              className="h-8 w-8 p-0 text-slate-600 hover:text-[#30539C] hover:bg-blue-50 rounded-lg transition-colors"
                            >
                              <Eye className="w-4 h-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleOpenEdit(u)}
                              title="Edit Staff Details"
                              className="h-8 w-8 p-0 text-slate-600 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors"
                            >
                              <Edit2 className="w-4 h-4" />
                            </Button>
                            {u.role !== "admin" && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  if (confirm(`Are you sure you want to delete user ${u.name}?`)) {
                                    deleteUserMutation.mutate(u._id);
                                  }
                                }}
                                title="Delete Staff Member"
                                className="h-8 w-8 p-0 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* CREATE STAFF / USER MODAL */}
      <Dialog open={isCreateModalOpen} onOpenChange={setIsCreateModalOpen}>
        <DialogContent className="max-w-2xl bg-white rounded-2xl shadow-2xl p-6 border border-slate-200">
          <DialogHeader>
            <DialogTitle className="text-base font-black text-slate-900 flex items-center gap-2">
              <UserPlus className="w-5 h-5 text-[#30539C]" />
              Onboard New Staff / Sales Representative Profile
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Create login credentials, assign manufacturer brand representation, KYC identity documents & branch permissions.
            </DialogDescription>
          </DialogHeader>

          {/* Modal Tab Selector */}
          <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl mt-2">
            {[
              { id: "login", label: "1. Login & Access" },
              { id: "kyc", label: "2. Personal & KYC" },
              { id: "salary", label: "3. Salary & Bank" },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  activeTab === tab.id ? "bg-white text-[#30539C] shadow-sm" : "text-slate-500 hover:text-slate-800"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              createUserMutation.mutate(formData);
            }}
            className="mt-4 space-y-4"
          >
            {/* TAB 1: LOGIN & ACCESS */}
            {activeTab === "login" && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1 sm:col-span-2">
                  <Label className="text-xs font-bold text-slate-700">Full Name *</Label>
                  <Input
                    required
                    placeholder="e.g. Amit Kumar (Haier Representative)"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="h-9 text-xs font-medium"
                  />
                </div>

                <div className="space-y-1 sm:col-span-2">
                  <Label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                    <Award className="w-3.5 h-3.5 text-[#30539C]" /> Assigned Brand (Sales Representative / Promoter)
                  </Label>
                  <Select
                    value={formData.assignedBrand || "none"}
                    onValueChange={(val) => setFormData({ ...formData, assignedBrand: val === "none" ? "" : val })}
                  >
                    <SelectTrigger className="h-9 text-xs font-bold bg-blue-50/40 border-blue-200">
                      <SelectValue placeholder="Select Brand Representative" />
                    </SelectTrigger>
                    <SelectContent className="max-h-60">
                      <SelectItem value="none" className="text-xs text-slate-500 font-medium">
                        🌐 General Store Executive (All Brands)
                      </SelectItem>
                      {brands.map((b: any) => (
                        <SelectItem key={b._id || b.id || b.name} value={b.name} className="text-xs font-bold">
                          🏷️ {b.name} (Sales Representative / ISD)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-slate-500">
                    Select which company brand this sales representative belongs to (e.g. Haier, Samsung, LG).
                  </p>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs font-bold text-slate-700">Login Email *</Label>
                  <Input
                    type="email"
                    required
                    placeholder="amit.sales@valueplus.in"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="h-9 text-xs font-medium"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs font-bold text-slate-700">Login Password *</Label>
                  <Input
                    type="password"
                    required
                    placeholder="••••••••"
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    className="h-9 text-xs font-medium font-mono"
                  />
                </div>

                <div className="space-y-1 sm:col-span-2">
                  <Label className="text-xs font-bold text-slate-700">Assigned User Role (Panel Access) *</Label>
                  <Select
                    value={formData.role}
                    onValueChange={(val) => setFormData({ ...formData, role: val })}
                  >
                    <SelectTrigger className="h-9 text-xs font-bold">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLE_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value} className="text-xs font-medium">
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {/* TAB 2: PERSONAL & KYC */}
            {activeTab === "kyc" && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label className="text-xs font-bold text-slate-700">Mobile Phone Number *</Label>
                  <Input
                    required
                    placeholder="9140860604"
                    value={formData.mobile}
                    onChange={(e) => setFormData({ ...formData, mobile: e.target.value })}
                    className="h-9 text-xs font-mono font-medium"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs font-bold text-slate-700">Designation / Job Title</Label>
                  <Input
                    placeholder="Senior Sales Executive"
                    value={formData.designation}
                    onChange={(e) => setFormData({ ...formData, designation: e.target.value })}
                    className="h-9 text-xs font-medium"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs font-bold text-slate-700">ID Proof Type (KYC)</Label>
                  <Select
                    value={formData.idProofType}
                    onValueChange={(val: any) => setFormData({ ...formData, idProofType: val })}
                  >
                    <SelectTrigger className="h-9 text-xs font-bold">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Aadhaar Card">Aadhaar Card (UIDAI)</SelectItem>
                      <SelectItem value="PAN Card">PAN Card (Income Tax)</SelectItem>
                      <SelectItem value="Voter ID">Voter ID Card</SelectItem>
                      <SelectItem value="Driving License">Driving License</SelectItem>
                      <SelectItem value="Passport">Passport</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs font-bold text-slate-700">Identity Proof Number</Label>
                  <Input
                    placeholder="e.g. 5421 8974 6321"
                    value={formData.idProofNumber}
                    onChange={(e) => setFormData({ ...formData, idProofNumber: e.target.value })}
                    className="h-9 text-xs font-mono font-medium"
                  />
                </div>

                <div className="space-y-1 sm:col-span-2">
                  <Label className="text-xs font-bold text-slate-700">Residential Address</Label>
                  <Textarea
                    placeholder="House No, Street, Landmark, Gorakhpur, UP - 273008"
                    value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                    className="text-xs min-h-[60px]"
                  />
                </div>
              </div>
            )}

            {/* TAB 3: SALARY & BANK */}
            {activeTab === "salary" && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label className="text-xs font-bold text-slate-700">Base Monthly Salary (₹) *</Label>
                  <Input
                    type="number"
                    required
                    placeholder="25000"
                    value={formData.monthlySalary}
                    onChange={(e) => setFormData({ ...formData, monthlySalary: e.target.value })}
                    className="h-9 text-xs font-mono font-bold text-slate-900"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs font-bold text-slate-700">Salary Structure</Label>
                  <Select
                    value={formData.salaryType}
                    onValueChange={(val: any) => setFormData({ ...formData, salaryType: val })}
                  >
                    <SelectTrigger className="h-9 text-xs font-bold">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Fixed">Fixed Monthly</SelectItem>
                      <SelectItem value="Fixed + Incentive">Fixed + Sales Incentive</SelectItem>
                      <SelectItem value="Commission Only">Commission Only</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs font-bold text-slate-700">Opening Advance Loan Balance (₹)</Label>
                  <Input
                    type="number"
                    placeholder="0"
                    value={formData.advanceBalance}
                    onChange={(e) => setFormData({ ...formData, advanceBalance: e.target.value })}
                    className="h-9 text-xs font-mono font-medium"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs font-bold text-slate-700">Monthly Advance EMI Deduction (₹)</Label>
                  <Input
                    type="number"
                    placeholder="2000"
                    value={formData.monthlyAdvanceDeduction}
                    onChange={(e) => setFormData({ ...formData, monthlyAdvanceDeduction: e.target.value })}
                    className="h-9 text-xs font-mono font-medium"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs font-bold text-slate-700">Bank Account Number</Label>
                  <Input
                    placeholder="987654321012"
                    value={formData.bankAccountNo}
                    onChange={(e) => setFormData({ ...formData, bankAccountNo: e.target.value })}
                    className="h-9 text-xs font-mono font-medium"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs font-bold text-slate-700">Bank IFSC Code</Label>
                  <Input
                    placeholder="SBIN0001234"
                    value={formData.bankIfsc}
                    onChange={(e) => setFormData({ ...formData, bankIfsc: e.target.value })}
                    className="h-9 text-xs font-mono font-medium"
                  />
                </div>
              </div>
            )}

            <DialogFooter className="pt-3 border-t border-slate-100 flex items-center justify-between">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setIsCreateModalOpen(false)}
                className="text-xs font-bold"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={createUserMutation.isPending}
                className="bg-[#76C043] hover:bg-[#68ac3b] text-white font-bold text-xs shadow-md px-6"
              >
                {createUserMutation.isPending ? "Creating..." : "Save & Register User"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ADJUST ADVANCE LOAN MODAL */}
      <Dialog open={isAdvanceModalOpen} onOpenChange={setIsAdvanceModalOpen}>
        <DialogContent className="max-w-md bg-white rounded-2xl shadow-2xl p-6 border border-slate-200">
          <DialogHeader>
            <DialogTitle className="text-base font-black text-slate-900 flex items-center gap-2">
              <Coins className="w-5 h-5 text-amber-600" />
              Adjust Advance Salary Loan
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Update loan/advance balance for <strong>{selectedUserForAdvance?.name}</strong>.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label className="text-xs font-bold text-slate-700">Current Advance Balance (₹)</Label>
              <Input
                type="number"
                value={advanceAmountInput}
                onChange={(e) => setAdvanceAmountInput(e.target.value)}
                className="h-9 text-xs font-mono font-bold text-slate-900"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-bold text-slate-700">Reason / Notes</Label>
              <Input
                placeholder="e.g. Festival advance sanctioned on 22 Aug"
                value={advanceNotesInput}
                onChange={(e) => setAdvanceNotesInput(e.target.value)}
                className="h-9 text-xs"
              />
            </div>
          </div>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setIsAdvanceModalOpen(false)}
              className="text-xs"
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (selectedUserForAdvance) {
                  updateAdvanceMutation.mutate({
                    id: selectedUserForAdvance._id,
                    newAdvance: Number(advanceAmountInput || 0),
                  });
                }
              }}
              disabled={updateAdvanceMutation.isPending}
              className="bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs"
            >
              {updateAdvanceMutation.isPending ? "Updating..." : "Confirm Update"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* VIEW FULL STAFF PROFILE MODAL */}
      <Dialog open={isViewModalOpen} onOpenChange={setIsViewModalOpen}>
        <DialogContent className="max-w-2xl bg-white rounded-3xl shadow-2xl p-0 overflow-y-auto border border-slate-200">
          {selectedUserForView && (
            <div>
              {/* Header Hero */}
              <div className="bg-gradient-to-r from-[#1A2744] via-[#2C3E5A] to-[#1A2744] p-6 text-white relative">
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 rounded-2xl bg-white/10 border-2 border-white/20 flex items-center justify-center text-xl font-black text-white shadow-lg overflow-hidden shrink-0">
                    {selectedUserForView.avatar ? (
                      <img src={selectedUserForView.avatar} alt={selectedUserForView.name} className="w-full h-full object-cover" />
                    ) : (
                      selectedUserForView.name?.substring(0, 2).toUpperCase()
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <h3 className="text-lg font-black text-white tracking-tight">{selectedUserForView.name}</h3>
                      <Badge className="bg-emerald-500/25 text-emerald-300 border border-emerald-400/40 text-[10px] uppercase font-bold px-2 py-0.5">
                        ● {selectedUserForView.status || "Active"}
                      </Badge>
                    </div>
                    <p className="text-xs text-slate-300 font-medium mt-0.5">{selectedUserForView.designation || "Staff Member"}</p>
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      <span className="px-2.5 py-0.5 rounded-full bg-white/15 text-[10px] font-extrabold uppercase tracking-wider text-slate-200 border border-white/10">
                        Role: {selectedUserForView.role}
                      </span>
                      {selectedUserForView.assignedBrand ? (
                        <span className="px-2.5 py-0.5 rounded-full bg-blue-500/30 border border-blue-400/40 text-blue-200 text-[10px] font-black flex items-center gap-1">
                          🏷️ {selectedUserForView.assignedBrand} (Company Sales Rep)
                        </span>
                      ) : (
                        <span className="px-2.5 py-0.5 rounded-full bg-white/10 text-slate-300 text-[10px] font-medium border border-white/5">
                          General Store Staff (All Brands)
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Body 4-Section Grid */}
              <div className="p-6 space-y-4 max-h-[65vh] overflow-y-auto">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Card 1: Contact & Location */}
                  <div className="p-4 rounded-2xl bg-slate-50/80 border border-slate-200 space-y-2.5">
                    <h4 className="text-xs font-black text-slate-900 uppercase tracking-wide flex items-center gap-1.5 pb-1 border-b border-slate-200">
                      <Phone className="w-3.5 h-3.5 text-[#30539C]" /> Contact & Showroom
                    </h4>
                    <div className="space-y-2 text-xs">
                      <div className="flex justify-between items-center py-0.5">
                        <span className="text-slate-500">Email Address:</span>
                        <span className="font-mono font-bold text-slate-800">{selectedUserForView.email}</span>
                      </div>
                      <div className="flex justify-between items-center py-0.5">
                        <span className="text-slate-500">Mobile Phone:</span>
                        <span className="font-mono font-bold text-slate-800">{selectedUserForView.mobile || "Not Provided"}</span>
                      </div>
                      <div className="flex justify-between items-center py-0.5">
                        <span className="text-slate-500">Assigned Branch:</span>
                        <span className="font-bold text-slate-800">{selectedUserForView.assignedWarehouseName || "Kunraghat Showroom"}</span>
                      </div>
                      <div className="flex justify-between items-center py-0.5">
                        <span className="text-slate-500">Joining Date:</span>
                        <span className="font-mono font-bold text-slate-800">{selectedUserForView.joiningDate || "—"}</span>
                      </div>
                    </div>
                  </div>

                  {/* Card 2: KYC & Verification */}
                  <div className="p-4 rounded-2xl bg-slate-50/80 border border-slate-200 space-y-2.5">
                    <h4 className="text-xs font-black text-slate-900 uppercase tracking-wide flex items-center gap-1.5 pb-1 border-b border-slate-200">
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" /> Identity KYC Verification
                    </h4>
                    <div className="space-y-2 text-xs">
                      <div className="flex justify-between items-center py-0.5">
                        <span className="text-slate-500">Document Type:</span>
                        <span className="font-bold text-slate-800">{selectedUserForView.idProofType || "Aadhaar Card"}</span>
                      </div>
                      <div className="flex justify-between items-center py-0.5">
                        <span className="text-slate-500">Document Number:</span>
                        <span className="font-mono font-bold text-slate-800 bg-white px-2 py-0.5 rounded border border-slate-200">
                          {selectedUserForView.idProofNumber || "DOC-NOT-SUBMITTED"}
                        </span>
                      </div>
                      <div className="flex justify-between items-center py-0.5">
                        <span className="text-slate-500">Verification Status:</span>
                        <span className="inline-flex items-center gap-1 font-bold text-emerald-600">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Verified Staff
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Card 3: Salary & Compensation */}
                  <div className="p-4 rounded-2xl bg-slate-50/80 border border-slate-200 space-y-2.5">
                    <h4 className="text-xs font-black text-slate-900 uppercase tracking-wide flex items-center gap-1.5 pb-1 border-b border-slate-200">
                      <DollarSign className="w-3.5 h-3.5 text-[#76C043]" /> Salary & Compensation
                    </h4>
                    <div className="space-y-2 text-xs">
                      <div className="flex justify-between items-center py-0.5">
                        <span className="text-slate-500">Monthly Salary:</span>
                        <span className="font-mono font-black text-[#30539C] text-sm">
                          {formatCurrency(selectedUserForView.monthlySalary || 0)}
                        </span>
                      </div>
                      <div className="flex justify-between items-center py-0.5">
                        <span className="text-slate-500">Salary Structure:</span>
                        <span className="font-bold text-slate-800">{selectedUserForView.salaryType || "Fixed"}</span>
                      </div>
                      <div className="flex justify-between items-center py-0.5">
                        <span className="text-slate-500">Advance Loan Balance:</span>
                        <span className={`font-mono font-bold ${selectedUserForView.advanceBalance > 0 ? "text-amber-600" : "text-slate-500"}`}>
                          {formatCurrency(selectedUserForView.advanceBalance || 0)}
                        </span>
                      </div>
                      <div className="flex justify-between items-center py-0.5">
                        <span className="text-slate-500">Monthly EMI Deduction:</span>
                        <span className="font-mono font-bold text-slate-800">
                          {formatCurrency(selectedUserForView.monthlyAdvanceDeduction || 0)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Card 4: Bank Account Details */}
                  <div className="p-4 rounded-2xl bg-slate-50/80 border border-slate-200 space-y-2.5">
                    <h4 className="text-xs font-black text-slate-900 uppercase tracking-wide flex items-center gap-1.5 pb-1 border-b border-slate-200">
                      <CreditCard className="w-3.5 h-3.5 text-indigo-600" /> Bank Payout Account
                    </h4>
                    <div className="space-y-2 text-xs">
                      <div className="flex justify-between items-center py-0.5">
                        <span className="text-slate-500">Bank Name:</span>
                        <span className="font-bold text-slate-800">{selectedUserForView.bankName || "State Bank of India"}</span>
                      </div>
                      <div className="flex justify-between items-center py-0.5">
                        <span className="text-slate-500">Account Number:</span>
                        <span className="font-mono font-bold text-slate-800">{selectedUserForView.bankAccountNo || "Not Linked"}</span>
                      </div>
                      <div className="flex justify-between items-center py-0.5">
                        <span className="text-slate-500">IFSC Code:</span>
                        <span className="font-mono font-bold text-slate-800">{selectedUserForView.bankIfsc || "SBIN0001234"}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Residential Address */}
                {selectedUserForView.address && (
                  <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs">
                    <span className="text-slate-500 font-medium">Residential Address: </span>
                    <span className="font-bold text-slate-800">
                      {selectedUserForView.address}, {selectedUserForView.city || "Gorakhpur"}, {selectedUserForView.state || "UP"} - {selectedUserForView.pincode || "273008"}
                    </span>
                  </div>
                )}
              </div>

              {/* Clean Footer with Single Primary Action */}
              <div className="p-4 bg-slate-100/90 border-t border-slate-200 flex items-center justify-between">
                <Button variant="ghost" onClick={() => setIsViewModalOpen(false)} className="text-xs font-bold text-slate-600 hover:text-slate-900">
                  Close
                </Button>
                <Button
                  onClick={() => {
                    setIsViewModalOpen(false);
                    handleOpenEdit(selectedUserForView);
                  }}
                  className="bg-[#30539C] hover:bg-[#1E3A8A] text-white font-bold text-xs gap-1.5 px-5 h-9 rounded-xl shadow-md transition-all"
                >
                  <Edit2 className="w-3.5 h-3.5" /> Edit Staff Profile
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* EDIT STAFF / USER PROFILE MODAL */}
      <Dialog open={isEditModalOpen} onOpenChange={setIsEditModalOpen}>
        <DialogContent className="max-w-2xl bg-white rounded-2xl shadow-2xl p-6 border border-slate-200 max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base font-black text-slate-900 flex items-center gap-2">
              <Edit2 className="w-5 h-5 text-amber-600" />
              Edit Staff Profile: {selectedUserForEdit?.name}
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Update employee role, assigned manufacturer brand, contact information, salary, and KYC verification details.
            </DialogDescription>
          </DialogHeader>

          {/* Modal Tab Selector */}
          <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl mt-2">
            {[
              { id: "login", label: "1. Account & Brand" },
              { id: "kyc", label: "2. Personal & KYC" },
              { id: "salary", label: "3. Salary & Bank" },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setEditActiveTab(tab.id as any)}
                className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  editActiveTab === tab.id ? "bg-white text-[#30539C] shadow-sm" : "text-slate-500 hover:text-slate-800"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (selectedUserForEdit) {
                updateUserMutation.mutate({
                  id: selectedUserForEdit._id,
                  ...editFormData,
                  monthlySalary: Number(editFormData.monthlySalary || 0),
                  advanceBalance: Number(editFormData.advanceBalance || 0),
                  monthlyAdvanceDeduction: Number(editFormData.monthlyAdvanceDeduction || 0),
                });
              }
            }}
            className="mt-4 space-y-4"
          >
            {/* TAB 1: ACCOUNT & BRAND */}
            {editActiveTab === "login" && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1 sm:col-span-2">
                  <Label className="text-xs font-bold text-slate-700">Full Name *</Label>
                  <Input
                    required
                    value={editFormData.name}
                    onChange={(e) => setEditFormData({ ...editFormData, name: e.target.value })}
                    className="h-9 text-xs font-medium"
                  />
                </div>

                <div className="space-y-1 sm:col-span-2">
                  <Label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                    <Award className="w-3.5 h-3.5 text-[#30539C]" /> Assigned Brand (Sales Representative / Promoter)
                  </Label>
                  <Select
                    value={editFormData.assignedBrand || "none"}
                    onValueChange={(val) => setEditFormData({ ...editFormData, assignedBrand: val === "none" ? "" : val })}
                  >
                    <SelectTrigger className="h-9 text-xs font-bold bg-blue-50/40 border-blue-200">
                      <SelectValue placeholder="-- Select Assigned Brand --" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">General Store Staff (All Brands / No Specific Brand)</SelectItem>
                      {brands.map((b: any) => (
                        <SelectItem key={b._id || b.name} value={b.name}>
                          🏷️ {b.name} (Exclusive Company Representative)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs font-bold text-slate-700">Designation / Title</Label>
                  <Input
                    value={editFormData.designation}
                    onChange={(e) => setEditFormData({ ...editFormData, designation: e.target.value })}
                    placeholder="e.g. Senior Sales Executive"
                    className="h-9 text-xs font-medium"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs font-bold text-slate-700">System Role *</Label>
                  <Select
                    value={editFormData.role}
                    onValueChange={(val) => setEditFormData({ ...editFormData, role: val })}
                  >
                    <SelectTrigger className="h-9 text-xs font-bold">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLE_OPTIONS.map((r) => (
                        <SelectItem key={r.value} value={r.value}>
                          {r.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs font-bold text-slate-700">Login Email Address *</Label>
                  <Input
                    type="email"
                    required
                    value={editFormData.email}
                    onChange={(e) => setEditFormData({ ...editFormData, email: e.target.value })}
                    className="h-9 text-xs font-mono font-medium"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs font-bold text-slate-700">New Password (Optional, leave blank to keep)</Label>
                  <Input
                    type="password"
                    placeholder="••••••••"
                    value={editFormData.password || ""}
                    onChange={(e) => setEditFormData({ ...editFormData, password: e.target.value })}
                    className="h-9 text-xs"
                  />
                </div>

                <div className="space-y-1 sm:col-span-2">
                  <Label className="text-xs font-bold text-slate-700">Assigned Branch / Showroom / Godown</Label>
                  <Select
                    value={editFormData.assignedWarehouseName}
                    onValueChange={(val) => setEditFormData({ ...editFormData, assignedWarehouseName: val })}
                  >
                    <SelectTrigger className="h-9 text-xs font-bold">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Ashoka Enterprises (Kunraghat Showroom)">
                        🏢 Ashoka Enterprises (Kunraghat Showroom)
                      </SelectItem>
                      <SelectItem value="Gorakhpur Central Godown (Warehouse)">
                        📦 Gorakhpur Central Godown (Warehouse)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs font-bold text-slate-700">Account Status</Label>
                  <Select
                    value={editFormData.status || "active"}
                    onValueChange={(val) => setEditFormData({ ...editFormData, status: val })}
                  >
                    <SelectTrigger className="h-9 text-xs font-bold">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Active (Full Access)</SelectItem>
                      <SelectItem value="inactive">Inactive / Suspended</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {/* TAB 2: PERSONAL & KYC */}
            {editActiveTab === "kyc" && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label className="text-xs font-bold text-slate-700">Mobile Phone Number</Label>
                  <Input
                    placeholder="10-digit mobile"
                    value={editFormData.mobile}
                    onChange={(e) => setEditFormData({ ...editFormData, mobile: e.target.value })}
                    className="h-9 text-xs font-mono font-medium"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs font-bold text-slate-700">Joining Date</Label>
                  <Input
                    type="date"
                    value={editFormData.joiningDate}
                    onChange={(e) => setEditFormData({ ...editFormData, joiningDate: e.target.value })}
                    className="h-9 text-xs"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs font-bold text-slate-700">ID Proof Type</Label>
                  <Select
                    value={editFormData.idProofType}
                    onValueChange={(val) => setEditFormData({ ...editFormData, idProofType: val })}
                  >
                    <SelectTrigger className="h-9 text-xs font-bold">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Aadhaar Card">Aadhaar Card</SelectItem>
                      <SelectItem value="PAN Card">PAN Card</SelectItem>
                      <SelectItem value="Voter ID">Voter ID</SelectItem>
                      <SelectItem value="Driving License">Driving License</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs font-bold text-slate-700">ID Document Number</Label>
                  <Input
                    placeholder="e.g. 5544 3322 1100"
                    value={editFormData.idProofNumber}
                    onChange={(e) => setEditFormData({ ...editFormData, idProofNumber: e.target.value })}
                    className="h-9 text-xs font-mono font-bold"
                  />
                </div>

                <div className="space-y-1 sm:col-span-2">
                  <Label className="text-xs font-bold text-slate-700">Residential Street Address</Label>
                  <Textarea
                    placeholder="House / Flat No, Street, Landmark"
                    value={editFormData.address}
                    onChange={(e) => setEditFormData({ ...editFormData, address: e.target.value })}
                    rows={2}
                    className="text-xs"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs font-bold text-slate-700">City</Label>
                  <Input
                    value={editFormData.city}
                    onChange={(e) => setEditFormData({ ...editFormData, city: e.target.value })}
                    className="h-9 text-xs"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs font-bold text-slate-700">Pincode</Label>
                  <Input
                    value={editFormData.pincode}
                    onChange={(e) => setEditFormData({ ...editFormData, pincode: e.target.value })}
                    className="h-9 text-xs font-mono"
                  />
                </div>
              </div>
            )}

            {/* TAB 3: SALARY & BANK */}
            {editActiveTab === "salary" && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label className="text-xs font-bold text-slate-700">Monthly Salary (₹)</Label>
                  <Input
                    type="number"
                    value={editFormData.monthlySalary}
                    onChange={(e) => setEditFormData({ ...editFormData, monthlySalary: e.target.value })}
                    className="h-9 text-xs font-mono font-bold text-slate-900"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs font-bold text-slate-700">Salary Structure</Label>
                  <Select
                    value={editFormData.salaryType}
                    onValueChange={(val) => setEditFormData({ ...editFormData, salaryType: val })}
                  >
                    <SelectTrigger className="h-9 text-xs font-bold">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Fixed">Fixed Monthly</SelectItem>
                      <SelectItem value="Fixed + Incentive">Fixed + Sales Incentive</SelectItem>
                      <SelectItem value="Commission Only">Commission Only</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs font-bold text-slate-700">Advance Loan Balance (₹)</Label>
                  <Input
                    type="number"
                    value={editFormData.advanceBalance}
                    onChange={(e) => setEditFormData({ ...editFormData, advanceBalance: e.target.value })}
                    className="h-9 text-xs font-mono font-medium"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs font-bold text-slate-700">Monthly Advance EMI Deduction (₹)</Label>
                  <Input
                    type="number"
                    value={editFormData.monthlyAdvanceDeduction}
                    onChange={(e) => setEditFormData({ ...editFormData, monthlyAdvanceDeduction: e.target.value })}
                    className="h-9 text-xs font-mono font-medium"
                  />
                </div>

                <div className="space-y-1 sm:col-span-2">
                  <Label className="text-xs font-bold text-slate-700">Bank Name</Label>
                  <Input
                    value={editFormData.bankName}
                    onChange={(e) => setEditFormData({ ...editFormData, bankName: e.target.value })}
                    className="h-9 text-xs font-medium"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs font-bold text-slate-700">Bank Account Number</Label>
                  <Input
                    value={editFormData.bankAccountNo}
                    onChange={(e) => setEditFormData({ ...editFormData, bankAccountNo: e.target.value })}
                    className="h-9 text-xs font-mono font-medium"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs font-bold text-slate-700">Bank IFSC Code</Label>
                  <Input
                    value={editFormData.bankIfsc}
                    onChange={(e) => setEditFormData({ ...editFormData, bankIfsc: e.target.value })}
                    className="h-9 text-xs font-mono font-medium"
                  />
                </div>
              </div>
            )}

            <DialogFooter className="pt-3 border-t border-slate-100 flex items-center justify-between">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setIsEditModalOpen(false)}
                className="text-xs font-bold"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={updateUserMutation.isPending}
                className="bg-[#30539C] hover:bg-[#1E3A8A] text-white font-bold text-xs shadow-md px-6"
              >
                {updateUserMutation.isPending ? "Saving Changes..." : "Save Staff Changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
