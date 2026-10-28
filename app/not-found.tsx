import Link from "next/link";
import { Button } from "@/components/ui/button";
import { FileQuestion, ArrowLeft } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <div className="max-w-md w-full bg-white rounded-2xl border border-slate-200 p-8 shadow-sm text-center">
        <div className="w-12 h-12 rounded-full bg-blue-50 text-[#3F63AD] flex items-center justify-center mx-auto mb-4">
          <FileQuestion className="w-6 h-6" />
        </div>
        <h2 className="text-2xl font-black text-slate-900 mb-1 font-mono">404</h2>
        <h3 className="text-base font-bold text-slate-800 mb-2">Page Not Found</h3>
        <p className="text-xs text-slate-500 mb-6">
          The page or route you are trying to access does not exist or has been moved.
        </p>
        <Link href="/dashboard">
          <Button className="bg-[#3F63AD] hover:bg-[#3F63AD]/90 text-white text-xs h-9 px-4">
            <ArrowLeft className="w-3.5 h-3.5 mr-2" /> Return to Dashboard
          </Button>
        </Link>
      </div>
    </div>
  );
}
