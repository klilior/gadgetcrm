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
      // Redirect immediately based on role
      let targetPage;
      
      if (currentUser.role === 'טכנאי') {
        targetPage = "RepairDashboard";
      } else if (currentUser.role === 'מנהל') {
        targetPage = "SalesDashboard";
      } else {
        // נציג או מנהל משמרת -> הדשבורד האישי
        targetPage = "AgentDashboard";
      }
      
      window.location.href = createPageUrl(targetPage);
    }
  }, [currentUser, isLoading]);

  return (
    <div className="h-screen w-full flex items-center justify-center bg-slate-50">
      <div className="flex flex-col items-center gap-4 text-gray-500">
        <Loader2 className="w-10 h-10 animate-spin text-blue-600" />
        <p className="text-lg font-medium">טוען מערכת...</p>
      </div>
    </div>
  );
}