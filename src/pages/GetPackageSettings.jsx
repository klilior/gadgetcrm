import React from "react";
import { useUser } from "../components/UserAuth";
import GetPackageSettingsPanel from "../components/getpackage/GetPackageSettingsPanel";
import { Card, CardContent } from "@/components/ui/card";
import { Truck } from "lucide-react";

export default function GetPackageSettings() {
  const { currentUser } = useUser();
  const isManager = currentUser?.role === "מנהל" || currentUser?.role === "admin";

  if (!isManager) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="p-8 text-center">
            <Truck className="w-16 h-16 mx-auto mb-4 text-gray-400" />
            <h2 className="text-xl font-bold text-gray-900 mb-2">גישה מוגבלת</h2>
            <p className="text-gray-600">הגדרות GetPackage זמינות למנהלים בלבד</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div dir="rtl" className="p-4 md:p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
          <Truck className="w-6 h-6 text-emerald-600" />
          הגדרות GetPackage
        </h1>
        <p className="text-sm text-gray-500 mt-1">הגדרות חיבור ומשלוחים דרך GetPackage</p>
      </div>
      <GetPackageSettingsPanel />
    </div>
  );
}