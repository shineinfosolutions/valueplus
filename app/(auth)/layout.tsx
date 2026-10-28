import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Login — ValuePlus ERP",
  description: "Sign in to your ValuePlus ERP account",
};

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
