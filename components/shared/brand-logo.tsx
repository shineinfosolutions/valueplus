"use client";

import React from "react";
import { cn } from "@/lib/utils";

// Brand accent colors for badges & theme
export const BRAND_COLORS: Record<string, { bg: string; text: string; border: string; hex: string }> = {
  SAMSUNG: { bg: "bg-[#1428A0]", text: "text-white", border: "border-[#1428A0]", hex: "#1428A0" },
  LG: { bg: "bg-[#A50034]", text: "text-white", border: "border-[#A50034]", hex: "#A50034" },
  DAIKIN: { bg: "bg-[#0097E6]", text: "text-white", border: "border-[#0097E6]", hex: "#0097E6" },
  VOLTAS: { bg: "bg-[#004B87]", text: "text-white", border: "border-[#004B87]", hex: "#004B87" },
  VOLTASBEKO: { bg: "bg-[#003366]", text: "text-white", border: "border-[#003366]", hex: "#003366" },
  HAVELLS: { bg: "bg-[#E31E24]", text: "text-white", border: "border-[#E31E24]", hex: "#E31E24" },
  WHIRLPOOL: { bg: "bg-[#D97706]", text: "text-white", border: "border-[#D97706]", hex: "#D97706" },
  HAIER: { bg: "bg-[#004A99]", text: "text-white", border: "border-[#004A99]", hex: "#004A99" },
  LLOYD: { bg: "bg-[#C8102E]", text: "text-white", border: "border-[#C8102E]", hex: "#C8102E" },
  BAJAJ: { bg: "bg-[#0055A5]", text: "text-white", border: "border-[#0055A5]", hex: "#0055A5" },
  CARRIER: { bg: "bg-[#0072CE]", text: "text-white", border: "border-[#0072CE]", hex: "#0072CE" },
  AISEN: { bg: "bg-[#4F46E5]", text: "text-white", border: "border-[#4F46E5]", hex: "#4F46E5" },
  PANASONIC: { bg: "bg-[#003087]", text: "text-white", border: "border-[#003087]", hex: "#003087" },
  "EUREKA FORBES": { bg: "bg-[#008080]", text: "text-white", border: "border-[#008080]", hex: "#008080" },
  "FRANK FABER": { bg: "bg-[#222222]", text: "text-white", border: "border-[#222222]", hex: "#222222" },
  FABER: { bg: "bg-[#222222]", text: "text-white", border: "border-[#222222]", hex: "#222222" },
  JBL: { bg: "bg-[#FF5500]", text: "text-white", border: "border-[#FF5500]", hex: "#FF5500" },
  LUMINOUS: { bg: "bg-[#0A2540]", text: "text-white", border: "border-[#0A2540]", hex: "#0A2540" },
  "MAHARAJA WHITELINE": { bg: "bg-[#B91C1C]", text: "text-white", border: "border-[#B91C1C]", hex: "#B91C1C" },
  HAPIPOLA: { bg: "bg-[#7C3AED]", text: "text-white", border: "border-[#7C3AED]", hex: "#7C3AED" },
  KRATOS: { bg: "bg-[#0F172A]", text: "text-white", border: "border-[#0F172A]", hex: "#0F172A" },
  OPPO: { bg: "bg-[#00875A]", text: "text-white", border: "border-[#00875A]", hex: "#00875A" },
  REALME: { bg: "bg-[#FFC700]", text: "text-slate-900", border: "border-[#FFC700]", hex: "#FFC700" },
  VIVO: { bg: "bg-[#008CD6]", text: "text-white", border: "border-[#008CD6]", hex: "#008CD6" },
  SAFESTAB: { bg: "bg-[#D97706]", text: "text-white", border: "border-[#D97706]", hex: "#D97706" },
  "V-GUARD": { bg: "bg-[#CA8A04]", text: "text-white", border: "border-[#CA8A04]", hex: "#CA8A04" },
  SUNFLAME: { bg: "bg-[#EA580C]", text: "text-white", border: "border-[#EA580C]", hex: "#EA580C" },
  TCL: { bg: "bg-[#E11D48]", text: "text-white", border: "border-[#E11D48]", hex: "#E11D48" },
  APPLE: { bg: "bg-black", text: "text-white", border: "border-black", hex: "#000000" },
  ONEPLUS: { bg: "bg-[#F50514]", text: "text-white", border: "border-[#F50514]", hex: "#F50514" },
  SONY: { bg: "bg-black", text: "text-white", border: "border-black", hex: "#000000" },
  BOAT: { bg: "bg-[#E11D48]", text: "text-white", border: "border-[#E11D48]", hex: "#E11D48" },
};

export function getBrandMeta(name: string) {
  const upper = (name || "").trim().toUpperCase();
  const color = BRAND_COLORS[upper] || {
    bg: "bg-[#30539C]",
    text: "text-white",
    border: "border-[#30539C]",
    hex: "#30539C",
  };
  return { color, upper };
}

interface BrandLogoProps {
  name: string;
  className?: string;
  size?: "sm" | "md" | "lg" | "xl";
}

export function BrandLogo({ name, className, size = "md" }: BrandLogoProps) {
  const { color, upper } = getBrandMeta(name);

  const containerSizes = {
    sm: "w-10 h-7 rounded-md p-0.5",
    md: "w-16 h-11 rounded-xl p-1.5",
    lg: "w-24 h-14 rounded-2xl p-2",
    xl: "w-28 h-16 rounded-2xl p-2.5",
  }[size];

  // Render authentic vector brand logo
  const renderVectorLogo = () => {
    switch (upper) {
      case "SAMSUNG":
        return (
          <svg viewBox="0 0 140 45" className="w-full h-full">
            <ellipse cx="70" cy="22.5" rx="66" ry="20" fill="#1428A0" transform="rotate(-6 70 22.5)" />
            <text x="70" y="28" fill="#FFFFFF" fontFamily="system-ui, -apple-system, sans-serif" fontWeight="900" fontSize="17" letterSpacing="1.5" textAnchor="middle">
              SAMSUNG
            </text>
          </svg>
        );

      case "LG":
        return (
          <svg viewBox="0 0 100 100" className="w-full h-full">
            <circle cx="50" cy="50" r="46" fill="#A50034" />
            <circle cx="34" cy="36" r="5" fill="#FFFFFF" />
            <path d="M 64 34 L 50 34 C 41 34 34 41 34 50 C 34 59 41 66 50 66 C 59 66 66 59 66 50 L 66 48 L 54 48" fill="none" stroke="#FFFFFF" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M 44 42 L 44 58 L 52 58" fill="none" stroke="#FFFFFF" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        );

      case "DAIKIN":
        return (
          <svg viewBox="0 0 130 45" className="w-full h-full">
            <polygon points="12,36 30,8 30,36" fill="#0097E6" />
            <text x="78" y="29" fill="#0097E6" fontFamily="Arial, sans-serif" fontWeight="900" fontSize="18" letterSpacing="1.5" textAnchor="middle">
              DAIKIN
            </text>
          </svg>
        );

      case "VOLTAS":
        return (
          <svg viewBox="0 0 130 45" className="w-full h-full">
            <rect width="130" height="45" rx="8" fill="#004B87" />
            <text x="65" y="24" fill="#FFFFFF" fontFamily="Arial Black, sans-serif" fontWeight="900" fontSize="16" letterSpacing="1.5" textAnchor="middle">
              VOLTAS
            </text>
            <text x="65" y="36" fill="#7DD3FC" fontFamily="sans-serif" fontWeight="700" fontSize="7" letterSpacing="1" textAnchor="middle">
              A TATA ENTERPRISE
            </text>
          </svg>
        );

      case "VOLTASBEKO":
        return (
          <svg viewBox="0 0 130 45" className="w-full h-full">
            <rect width="130" height="45" rx="8" fill="#003366" />
            <text x="65" y="22" fill="#FFFFFF" fontFamily="Arial Black, sans-serif" fontWeight="900" fontSize="12" letterSpacing="1" textAnchor="middle">
              VOLTAS
            </text>
            <rect x="25" y="26" width="80" height="13" rx="4" fill="#0284C7" />
            <text x="65" y="36" fill="#FFFFFF" fontFamily="sans-serif" fontWeight="900" fontSize="9" letterSpacing="1.5" textAnchor="middle">
              beko
            </text>
          </svg>
        );

      case "HAVELLS":
        return (
          <svg viewBox="0 0 130 45" className="w-full h-full">
            <rect x="5" y="10" width="24" height="24" rx="4" fill="#E31E24" />
            <path d="M12 16 L22 28 M22 16 L12 28" stroke="#FFFFFF" strokeWidth="3.5" strokeLinecap="round" />
            <text x="78" y="28" fill="#E31E24" fontFamily="Arial Black, sans-serif" fontWeight="900" fontSize="15" letterSpacing="1" textAnchor="middle">
              HAVELLS
            </text>
          </svg>
        );

      case "WHIRLPOOL":
        return (
          <svg viewBox="0 0 130 45" className="w-full h-full">
            <circle cx="22" cy="22" r="14" fill="none" stroke="#D97706" strokeWidth="4" />
            <path d="M 14 22 C 14 14 30 14 30 22 C 30 30 14 30 14 22" fill="none" stroke="#D97706" strokeWidth="3" />
            <text x="76" y="28" fill="#1E293B" fontFamily="Georgia, serif" fontWeight="900" fontSize="15" letterSpacing="0.5" textAnchor="middle">
              Whirlpool
            </text>
          </svg>
        );

      case "HAIER":
        return (
          <svg viewBox="0 0 130 45" className="w-full h-full">
            <circle cx="16" cy="15" r="4" fill="#E11D48" />
            <circle cx="16" cy="28" r="4" fill="#2563EB" />
            <text x="72" y="29" fill="#004A99" fontFamily="Arial Black, sans-serif" fontWeight="900" fontSize="20" letterSpacing="1" textAnchor="middle">
              Haier
            </text>
          </svg>
        );

      case "LLOYD":
        return (
          <svg viewBox="0 0 130 45" className="w-full h-full">
            <rect width="130" height="45" rx="8" fill="#C8102E" />
            <text x="65" y="28" fill="#FFFFFF" fontFamily="Arial Black, sans-serif" fontWeight="900" fontSize="18" letterSpacing="2" textAnchor="middle">
              LLOYD
            </text>
            <text x="65" y="38" fill="#FECDD3" fontFamily="sans-serif" fontWeight="600" fontSize="6.5" letterSpacing="0.8" textAnchor="middle">
              A HAVELLS BRAND
            </text>
          </svg>
        );

      case "BAJAJ":
        return (
          <svg viewBox="0 0 130 45" className="w-full h-full">
            <polygon points="10,12 24,22.5 10,33" fill="#0055A5" />
            <polygon points="18,12 32,22.5 18,33" fill="#0055A5" />
            <text x="78" y="29" fill="#0055A5" fontFamily="Arial Black, sans-serif" fontWeight="900" fontSize="17" letterSpacing="1.5" textAnchor="middle">
              BAJAJ
            </text>
          </svg>
        );

      case "CARRIER":
        return (
          <svg viewBox="0 0 130 45" className="w-full h-full">
            <ellipse cx="65" cy="22.5" rx="60" ry="18" fill="none" stroke="#0072CE" strokeWidth="3" />
            <text x="65" y="28" fill="#0072CE" fontFamily="Brush Script MT, cursive, Arial Black, sans-serif" fontStyle="italic" fontWeight="900" fontSize="18" letterSpacing="1" textAnchor="middle">
              Carrier
            </text>
          </svg>
        );

      case "AISEN":
        return (
          <svg viewBox="0 0 130 45" className="w-full h-full">
            <rect width="130" height="45" rx="8" fill="#4F46E5" />
            <text x="65" y="29" fill="#FFFFFF" fontFamily="Arial Black, sans-serif" fontWeight="900" fontSize="19" letterSpacing="2.5" textAnchor="middle">
              AISEN
            </text>
          </svg>
        );

      case "PANASONIC":
        return (
          <svg viewBox="0 0 130 45" className="w-full h-full">
            <rect width="130" height="45" rx="6" fill="#003087" />
            <text x="65" y="28" fill="#FFFFFF" fontFamily="Arial Black, sans-serif" fontWeight="900" fontSize="13" letterSpacing="1" textAnchor="middle">
              Panasonic
            </text>
          </svg>
        );

      case "JBL":
        return (
          <svg viewBox="0 0 100 100" className="w-full h-full">
            <rect width="100" height="100" rx="16" fill="#FF5500" />
            <circle cx="28" cy="40" r="10" fill="#FFFFFF" />
            <rect x="38" y="24" width="12" height="52" rx="4" fill="#FFFFFF" />
            <text x="70" y="66" fill="#FFFFFF" fontFamily="Arial Black, sans-serif" fontWeight="900" fontSize="42" textAnchor="middle">
              L
            </text>
          </svg>
        );

      case "EUREKA FORBES":
        return (
          <svg viewBox="0 0 130 45" className="w-full h-full">
            <path d="M12 10 L28 10 L28 26 C28 34 12 36 12 36 C12 36 -4 34 -4 26 L-4 10 Z" fill="#008080" transform="translate(10, 0) scale(0.8)" />
            <text x="75" y="22" fill="#008080" fontFamily="Arial Black, sans-serif" fontWeight="900" fontSize="11" letterSpacing="0.5" textAnchor="middle">
              EUREKA
            </text>
            <text x="75" y="34" fill="#0F766E" fontFamily="sans-serif" fontWeight="900" fontSize="10" letterSpacing="1" textAnchor="middle">
              FORBES
            </text>
          </svg>
        );

      case "FRANK FABER":
      case "FABER":
        return (
          <svg viewBox="0 0 130 45" className="w-full h-full">
            <rect width="130" height="45" rx="8" fill="#222222" />
            <circle cx="22" cy="22.5" r="10" fill="#E11D48" />
            <text x="76" y="29" fill="#FFFFFF" fontFamily="Arial Black, sans-serif" fontWeight="900" fontSize="18" letterSpacing="2" textAnchor="middle">
              FABER
            </text>
          </svg>
        );

      case "LUMINOUS":
        return (
          <svg viewBox="0 0 130 45" className="w-full h-full">
            <circle cx="20" cy="22.5" r="9" fill="#F59E0B" />
            <path d="M 20 6 L 20 10 M 20 35 L 20 39 M 4 22.5 L 8 22.5 M 32 22.5 L 36 22.5" stroke="#F59E0B" strokeWidth="2.5" strokeLinecap="round" />
            <text x="76" y="28" fill="#0A2540" fontFamily="Arial Black, sans-serif" fontWeight="900" fontSize="13" letterSpacing="1" textAnchor="middle">
              LUMINOUS
            </text>
          </svg>
        );

      case "MAHARAJA WHITELINE":
        return (
          <svg viewBox="0 0 130 45" className="w-full h-full">
            <path d="M10 28 L14 16 L20 22 L26 16 L30 28 Z" fill="#B91C1C" />
            <text x="75" y="23" fill="#B91C1C" fontFamily="Arial Black, sans-serif" fontWeight="900" fontSize="11" letterSpacing="0.8" textAnchor="middle">
              MAHARAJA
            </text>
            <text x="75" y="35" fill="#475569" fontFamily="sans-serif" fontWeight="700" fontSize="8" letterSpacing="1" textAnchor="middle">
              WHITELINE
            </text>
          </svg>
        );

      case "OPPO":
        return (
          <svg viewBox="0 0 120 45" className="w-full h-full">
            <rect width="120" height="45" rx="8" fill="#00875A" />
            <text x="60" y="30" fill="#FFFFFF" fontFamily="sans-serif" fontWeight="900" fontSize="22" letterSpacing="2" textAnchor="middle">
              oppo
            </text>
          </svg>
        );

      case "REALME":
        return (
          <svg viewBox="0 0 120 45" className="w-full h-full">
            <rect width="120" height="45" rx="8" fill="#FFC700" />
            <text x="60" y="29" fill="#0F172A" fontFamily="sans-serif" fontWeight="900" fontSize="19" letterSpacing="1.5" textAnchor="middle">
              realme
            </text>
          </svg>
        );

      case "VIVO":
        return (
          <svg viewBox="0 0 120 45" className="w-full h-full">
            <rect width="120" height="45" rx="8" fill="#008CD6" />
            <text x="60" y="30" fill="#FFFFFF" fontFamily="sans-serif" fontWeight="900" fontSize="22" letterSpacing="2" textAnchor="middle">
              vivo
            </text>
          </svg>
        );

      case "V-GUARD":
      case "VGUARD":
        return (
          <svg viewBox="0 0 130 45" className="w-full h-full">
            <polygon points="12,12 28,12 20,32" fill="#CA8A04" />
            <text x="76" y="28" fill="#854D0E" fontFamily="Arial Black, sans-serif" fontWeight="900" fontSize="15" letterSpacing="1" textAnchor="middle">
              V-GUARD
            </text>
          </svg>
        );

      case "SUNFLAME":
        return (
          <svg viewBox="0 0 130 45" className="w-full h-full">
            <circle cx="20" cy="22.5" r="10" fill="#EA580C" />
            <path d="M 20 15 C 24 18 24 24 20 28 C 16 24 16 18 20 15" fill="#FEF08A" />
            <text x="76" y="28" fill="#EA580C" fontFamily="Arial Black, sans-serif" fontWeight="900" fontSize="13" letterSpacing="1" textAnchor="middle">
              SUNFLAME
            </text>
          </svg>
        );

      case "TCL":
        return (
          <svg viewBox="0 0 100 45" className="w-full h-full">
            <rect width="100" height="45" rx="8" fill="#E11D48" />
            <text x="50" y="30" fill="#FFFFFF" fontFamily="Arial Black, sans-serif" fontWeight="900" fontSize="24" letterSpacing="2" textAnchor="middle">
              TCL
            </text>
          </svg>
        );

      case "SAFESTAB":
        return (
          <svg viewBox="0 0 130 45" className="w-full h-full">
            <path d="M12 12 L28 12 L28 24 C28 32 20 36 20 36 C20 36 12 32 12 24 Z" fill="#D97706" />
            <text x="76" y="28" fill="#D97706" fontFamily="Arial Black, sans-serif" fontWeight="900" fontSize="13" letterSpacing="1" textAnchor="middle">
              SAFESTAB
            </text>
          </svg>
        );

      case "HAPIPOLA":
        return (
          <svg viewBox="0 0 130 45" className="w-full h-full">
            <rect width="130" height="45" rx="8" fill="#7C3AED" />
            <text x="65" y="28" fill="#FFFFFF" fontFamily="sans-serif" fontWeight="900" fontSize="14" letterSpacing="1.5" textAnchor="middle">
              hapipola
            </text>
          </svg>
        );

      case "KRATOS":
        return (
          <svg viewBox="0 0 130 45" className="w-full h-full">
            <rect width="130" height="45" rx="8" fill="#0F172A" />
            <text x="65" y="28" fill="#FFFFFF" fontFamily="Impact, Arial Black, sans-serif" fontWeight="900" fontSize="17" letterSpacing="2" textAnchor="middle">
              KRATOS
            </text>
          </svg>
        );

      case "APPLE":
        return (
          <svg viewBox="0 0 100 100" className="w-full h-full">
            <rect width="100" height="100" rx="16" fill="#000000" />
            <path d="M50 32 C52 28 55 25 59 24 C60 28 58 32 55 34 C53 36 50 35 50 32 Z M63 53 C63 46 68 43 68 43 C64 38 59 38 57 38 C52 38 49 40 46 40 C44 40 40 38 36 38 C30 38 24 43 24 52 C24 64 33 76 38 76 C41 76 43 74 46 74 C49 74 51 76 54 76 C59 76 68 65 68 65 C68 65 63 62 63 53 Z" fill="#FFFFFF" />
          </svg>
        );

      case "SONY":
        return (
          <svg viewBox="0 0 120 45" className="w-full h-full">
            <rect width="120" height="45" rx="6" fill="#000000" />
            <text x="60" y="29" fill="#FFFFFF" fontFamily="Georgia, serif" fontWeight="900" fontSize="18" letterSpacing="3" textAnchor="middle">
              SONY
            </text>
          </svg>
        );

      case "BOAT":
        return (
          <svg viewBox="0 0 120 45" className="w-full h-full">
            <rect width="120" height="45" rx="8" fill="#E11D48" />
            <text x="60" y="30" fill="#FFFFFF" fontFamily="sans-serif" fontWeight="900" fontSize="18" letterSpacing="1" textAnchor="middle">
              boAt
            </text>
          </svg>
        );

      default:
        return (
          <div className={cn("w-full h-full rounded-xl flex items-center justify-center font-black tracking-tight uppercase shadow-inner select-none", color.bg, color.text)}>
            <span className="text-xs font-black">{upper.slice(0, 4)}</span>
          </div>
        );
    }
  };

  return (
    <div
      className={cn(
        "relative flex items-center justify-center bg-white border border-slate-200/90 shadow-sm overflow-hidden flex-shrink-0 group-hover:shadow-md transition-all",
        containerSizes,
        className
      )}
      title={name}
    >
      <div className="w-full h-full flex items-center justify-center">
        {renderVectorLogo()}
      </div>
    </div>
  );
}
