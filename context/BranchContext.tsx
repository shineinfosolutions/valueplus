"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import { useSession } from "next-auth/react";

export interface BranchOrGodown {
  id: string;
  name: string;
  code: string;
  type: "showroom" | "warehouse";
  city: string;
  address: string;
  isDefault?: boolean;
}

export const DEFAULT_BRANCHES: BranchOrGodown[] = [
  {
    id: "branch-kunraghat",
    name: "Ashoka Enterprises (Kunraghat Showroom)",
    code: "VP-KUN",
    type: "showroom",
    city: "Gorakhpur",
    address: "H. No. 116, Near Shanti Marriage House, Deoria Rd, Kunraghat",
    isDefault: true,
  },
  {
    id: "branch-deoria",
    name: "Value Plus (Deoria Road Branch)",
    code: "VP-DEO",
    type: "showroom",
    city: "Gorakhpur",
    address: "Deoria Bypass Road, Gorakhpur",
  },
  {
    id: "godown-main",
    name: "Godown",
    code: "GDN-MAIN",
    type: "warehouse",
    city: "Gorakhpur",
    address: "Plot 42, Transport Nagar Central Logistics Godown, Gorakhpur",
  },
  {
    id: "godown-industrial",
    name: "GIDA Industrial Area Godown",
    code: "GDN-GIDA",
    type: "warehouse",
    city: "Gorakhpur",
    address: "Sector 13, GIDA Industrial Area, Gorakhpur",
  },
];

interface BranchContextType {
  activeLocation: BranchOrGodown;
  setActiveLocation: (location: BranchOrGodown) => void;
  locations: BranchOrGodown[];
  isGodown: boolean;
  isShowroom: boolean;
  switchLocationById: (id: string) => void;
}

const BranchContext = createContext<BranchContextType>({
  activeLocation: DEFAULT_BRANCHES[0],
  setActiveLocation: () => {},
  locations: DEFAULT_BRANCHES,
  isGodown: false,
  isShowroom: true,
  switchLocationById: () => {},
});

export function BranchProvider({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();
  const [locations, setLocations] = useState<BranchOrGodown[]>(DEFAULT_BRANCHES);
  const [activeLocation, setActiveLocationState] = useState<BranchOrGodown>(DEFAULT_BRANCHES[0]);

  const refreshLocations = async () => {
    try {
      const res = await fetch("/api/warehouses");
      const json = await res.json();
      if (json.success && Array.isArray(json.data) && json.data.length > 0) {
        const apiLocations: BranchOrGodown[] = json.data.map((w: any) => ({
          id: w._id || w.id || w.code,
          name: w.name,
          code: w.code || "WH-01",
          // Prefer the real Warehouse.type field; the keyword guess only
          // covers warehouses saved before that field existed.
          type: w.type === "godown" ? "warehouse" : w.type === "showroom" ? "showroom" : (w.name?.toLowerCase().includes("godown") || w.name?.toLowerCase().includes("warehouse") || w.name?.toLowerCase().includes("gida") || w.name?.toLowerCase().includes("logistics")) ? "warehouse" : "showroom",
          city: w.city || "Gorakhpur",
          address: w.address || "",
          isDefault: !!w.isDefault,
        }));

        setLocations(apiLocations);

        // A role without switch rights is locked to their own assigned
        // location server-side — the sidebar already shows this as a "🔒
        // Assigned Location" badge, but until now nothing actually reset
        // this context to match, so a stale/tampered localStorage value
        // could silently disagree with it. For everyone else, the user's
        // last manual choice (or the warehouse default) still wins.
        const user = session?.user as any;
        const isLocked = Boolean(
          user && user.role !== "admin" && user.assignedWarehouseName && user.assignedWarehouseName !== "ALL" && !user.canSwitchWarehouse
        );

        if (isLocked) {
          const assigned = apiLocations.find(
            (l) => l.name.toLowerCase() === String(user.assignedWarehouseName).toLowerCase()
          );
          if (assigned) {
            setActiveLocationState(assigned);
            return;
          }
        }

        // Update active location safely
        const saved = typeof window !== "undefined" ? localStorage.getItem("vp_active_location") : null;
        if (saved) {
          try {
            const parsed = JSON.parse(saved);
            const matched = apiLocations.find(l => l.name.toLowerCase() === parsed.name?.toLowerCase() || l.id === parsed.id);
            if (matched) {
              setActiveLocationState(matched);
            } else {
              const def = apiLocations.find(l => l.isDefault) || apiLocations[0];
              setActiveLocationState(def);
            }
          } catch (e) {
            setActiveLocationState(apiLocations[0]);
          }
        } else {
          const def = apiLocations.find(l => l.isDefault) || apiLocations[0];
          setActiveLocationState(def);
        }
      }
    } catch (err) {
      console.warn("Notice loading warehouses from API:", err);
    }
  };

  useEffect(() => {
    refreshLocations();

    const handleUpdate = () => {
      refreshLocations();
    };

    window.addEventListener("erp-warehouses-updated", handleUpdate);
    return () => {
      window.removeEventListener("erp-warehouses-updated", handleUpdate);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user]);

  const setActiveLocation = (loc: BranchOrGodown) => {
    setActiveLocationState(loc);
    try {
      localStorage.setItem("vp_active_location", JSON.stringify(loc));
      window.dispatchEvent(new CustomEvent("erp-location-changed", { detail: loc }));
    } catch (e) {
      console.error(e);
    }
  };

  const switchLocationById = (id: string) => {
    const found = locations.find((l) => l.id === id);
    if (found) {
      setActiveLocation(found);
    }
  };

  const isGodown = activeLocation.type === "warehouse";
  const isShowroom = activeLocation.type === "showroom";

  return (
    <BranchContext.Provider
      value={{
        activeLocation,
        setActiveLocation,
        locations,
        isGodown,
        isShowroom,
        switchLocationById,
      }}
    >
      {children}
    </BranchContext.Provider>
  );
}

export function useBranch() {
  return useContext(BranchContext);
}
