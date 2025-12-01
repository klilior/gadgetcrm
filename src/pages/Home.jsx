import React, { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useUser } from "../components/UserAuth";
import { createPageUrl } from "@/utils";
import { Loader2 } from "lucide-react";

export default function Home() {
  const { currentUser, isLoading } = useUser();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isLoading && currentUser) {
      // Redirect based on role - טכנאי goes to repairs, everyone else to sales dashboard
      if (currentUser.role === 'טכנאי') {
        navigate(createPageUrl("RepairDashboard"), { replace: true });
      } else {
        navigate(createPageUrl("SalesDashboard"), { replace: true });
      }
    }
  }, [currentUser, isLoading, navigate]);

  return (
    <div className="h-screen w-full flex items-center justify-center bg-slate-50">
      <div className="flex flex-col items-center gap-4 text-gray-500">
        <Loader2 className="w-10 h-10 animate-spin text-blue-600" />
        <p className="text-lg font-medium">טוען מערכת...</p>
      </div>
    </div>
  );
}