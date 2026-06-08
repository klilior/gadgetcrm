import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Truck, Package, Loader2, List, UserCheck } from "lucide-react";
import { base44 } from "@/api/base44Client";
import UPSShipmentForm from "../components/shipping/UPSShipmentForm";
import CargoShipmentForm from "../components/shipping/CargoShipmentForm";
import GetPackageShipmentForm from "../components/shipping/GetPackageShipmentForm";
import CargoShipmentsList from "../components/shipping/CargoShipmentsList";
import CustomerLookupPanel, { customerToShipmentData } from "../components/customers/CustomerLookupPanel";

export default function Shipments() {
  const [activeProviders, setActiveProviders] = useState({ ups: false, cargo: false, getpackage: false });
  const [loadingProviders, setLoadingProviders] = useState(true);
  const [selectedCustomer, setSelectedCustomer] = useState(null);

  useEffect(() => {
    const loadProviders = async () => {
      const map = { ups: false, cargo: false, getpackage: false };
      try {
        // Check UPS - ship.co.il is always available if secrets are set
        map.ups = true; // UPS is always configured via secrets
      } catch (_) {}
      try {
        const providers = await base44.entities.ShippingProvider.list();
        for (const p of providers) {
          if (p.provider_type === 'cargo' && p.is_active) map.cargo = true;
        }
      } catch (_) {}
      try {
        const gpSettings = await base44.entities.GetPackageSettings.list('-created_date', 1);
        if (gpSettings?.[0]?.is_active) map.getpackage = true;
      } catch (_) {}
      setActiveProviders(map);
      setLoadingProviders(false);
    };
    loadProviders();
  }, []);

  if (loadingProviders) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
      </div>
    );
  }

  return (
    <div className="p-3 md:p-6 space-y-5">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-200">
          <Truck className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-2xl md:text-3xl font-black text-gray-900">יצירת משלוח</h1>
          <p className="text-gray-400 text-sm">שלח חבילה דרך כל ספקי המשלוח הפעילים</p>
        </div>
      </div>

      <CustomerLookupPanel
        onSelect={setSelectedCustomer}
      />

      {selectedCustomer && (
        <div className="flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          <UserCheck className="w-4 h-4" />
          נטענו פרטי הלקוח: <strong>{selectedCustomer.full_name}</strong>
        </div>
      )}

      {/* Provider status */}
      <div className="flex flex-wrap gap-2">
        <Badge className={activeProviders.ups ? "bg-green-100 text-green-700 border-green-200" : "bg-red-100 text-red-700 border-red-200"}>
          UPS {activeProviders.ups ? "✓" : "✗"}
        </Badge>
        <Badge className={activeProviders.cargo ? "bg-green-100 text-green-700 border-green-200" : "bg-red-100 text-red-700 border-red-200"}>
          קארגו {activeProviders.cargo ? "✓" : "✗"}
        </Badge>
        <Badge className={activeProviders.getpackage ? "bg-green-100 text-green-700 border-green-200" : "bg-red-100 text-red-700 border-red-200"}>
          GetPackage {activeProviders.getpackage ? "✓" : "✗"}
        </Badge>
      </div>

      <Tabs defaultValue="shipments_list" dir="rtl">
        <TabsList className="w-full grid grid-cols-4 h-12">
          <TabsTrigger value="shipments_list" className="text-sm data-[state=active]:bg-indigo-600 data-[state=active]:text-white">
            <List className="w-4 h-4 ml-1" />
            שטרי מטען
          </TabsTrigger>
          <TabsTrigger value="ups" className="text-sm data-[state=active]:bg-purple-600 data-[state=active]:text-white" disabled={!activeProviders.ups}>
            <Package className="w-4 h-4 ml-1" />
            UPS
          </TabsTrigger>
          <TabsTrigger value="cargo" className="text-sm data-[state=active]:bg-blue-600 data-[state=active]:text-white" disabled={!activeProviders.cargo}>
            <Truck className="w-4 h-4 ml-1" />
            קארגו
          </TabsTrigger>
          <TabsTrigger value="getpackage" className="text-sm data-[state=active]:bg-emerald-600 data-[state=active]:text-white" disabled={!activeProviders.getpackage}>
            <Truck className="w-4 h-4 ml-1" />
            GetPackage
          </TabsTrigger>
        </TabsList>

        <TabsContent value="shipments_list">
          <CargoShipmentsList />
        </TabsContent>

        <TabsContent value="ups">
          <UPSShipmentForm initialCustomer={customerToShipmentData(selectedCustomer)} />
        </TabsContent>

        <TabsContent value="cargo">
          <CargoShipmentForm initialCustomer={customerToShipmentData(selectedCustomer)} />
        </TabsContent>

        <TabsContent value="getpackage">
          <GetPackageShipmentForm initialCustomer={customerToShipmentData(selectedCustomer)} />
        </TabsContent>
      </Tabs>
    </div>
  );
}